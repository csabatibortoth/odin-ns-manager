// Blocks the names of the blocklists: lists such as
// https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts, which are
// downloaded from their address, kept in MongoDB, and answered from memory.
//
// - A blocked name is not looked up at the upstream. It is answered with the
//   address 0.0.0.0 (and ::), or with "no such name": the nsBlockMode setting.
// - The own zones and standalone records come first; an allowed name is never blocked.
// - A list is downloaded again every nsBlocklistRefresh hours. When that
//   fails, the names of the last download stay in use.
const net = require('net');
const zlib = require('zlib');
const { promisify } = require('util');
const named = require('njord-ns-server');
const config = require('../../config/config');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const SYNC_SECONDS = 15; // between two looks at the database
const RETRY_MINUTES = 15; // after a download that failed
const DOWNLOAD_TIMEOUT = 60000;
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const BLOCKED_TTL = 300;

// What a hosts file says about the machine itself, not about what to block
const LOCAL_NAMES = new Set(['localhost', 'localhost.localdomain', 'local', 'broadcasthost', 'ip6-localhost', 'ip6-loopback', '0.0.0.0']);
const NAME = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{2,63}$/;

const cleanName = (name) => name.toLowerCase().replace(/\.$/, '');
const parentOf = (name) => name.slice(name.indexOf('.') + 1);

let blocked = new Set(); // the names of the lists
let blockedBelow = new Set(); // the names whose subdomains are blocked as well
let allowed = new Set(); // these and the names below them are never blocked
let listCount = 0;

///--- Lists

// The names of a list, without duplicates. Understands the lines of a hosts
// file ("0.0.0.0 ads.example.com"), plain names, and the "||ads.example.com^"
// of the filter lists of ad blockers. Comments start with # or !.
function parseList(text) {
    const names = new Set();
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, '').trim();
        if (!line || line.startsWith('!') || line.startsWith('[')) continue;

        let words = line.split(/\s+/);
        if (net.isIP(words[0])) words = words.slice(1);
        else if (words.length > 1) continue; // not a line of names
        for (const word of words) {
            const name = cleanName(word.replace(/^\|\|/, '').replace(/\^$/, ''));
            if (NAME.test(name) && !LOCAL_NAMES.has(name)) names.add(name);
        }
    }
    return [...names];
}

// Is the name one of these, or below one of them?
function within(set, name) {
    for (let rest = name; ; rest = parentOf(rest)) {
        if (set.has(rest)) return true;
        if (!rest.includes('.')) return false;
    }
}

function isBlocked(name) {
    if (!config.nsBlockingEnabled || !blocked.size) return false;
    name = cleanName(name);
    if (!blocked.has(name) && !(blockedBelow.size && within(blockedBelow, name))) return false;
    return !(allowed.size && within(allowed, name));
}

// Answers a query of the server when its name is blocked. Returns false when
// it is not, and the query is left for the upstream lookup.
function resolve(query) {
    const name = query.name();
    if (!isBlocked(name)) return false;

    query._flags.ra = true;
    if (config.nsBlockMode === 'nxdomain') query.setError('enoname');
    else if (query.type() === 'A') query.addAnswer(name, new named.ARecord('0.0.0.0'), BLOCKED_TTL);
    else if (query.type() === 'AAAA') query.addAnswer(name, new named.AAAARecord('::'), BLOCKED_TTL);
    // The other types get an empty answer
    return true;
}

// lists: [{ names: [...], subdomains }], allowedNames: [...]
function replace(lists, allowedNames = []) {
    const nextBlocked = new Set();
    const nextBelow = new Set();
    for (const list of lists) {
        for (const name of list.names) {
            nextBlocked.add(name);
            if (list.subdomains) nextBelow.add(name);
        }
    }
    blocked = nextBlocked;
    blockedBelow = nextBelow;
    allowed = new Set(allowedNames);
    listCount = lists.length;
}

///--- The database and the downloads

// Required late: the lookups above have to work without a database.
const models = () => require('../../model/mongoDB/blocklistModel');
const logs = () => require('../apiService/apiService').logService;

let stamp = null;
let running = null;
let queued = false;
let timer = null;
let failing = false;
let loadedAt = null;
const downloading = new Set(); // ids of the lists that are being downloaded

async function fetchText(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT), redirect: 'follow', headers: { Accept: 'text/plain, */*' } });
    if (!response.ok) throw new Error(`The server of the list answered ${response.status}`);

    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_DOWNLOAD_BYTES) throw new Error('The list is larger than 64 MB');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

// Downloads a list, and saves its names. A failure is saved with the list,
// which keeps the names it had. Returns the list.
async function download(list) {
    const id = String(list._id);
    if (downloading.has(id)) return list;
    downloading.add(id);
    try {
        list.checkedAt = new Date();
        try {
            const text = await fetchText(list.url);
            if (/^\s*<(!doctype|html)/i.test(text)) throw new Error('The address answers with a web page, not with a list');
            const names = parseList(text);
            if (!names.length) throw new Error('No names are found in the list');

            list.content = await gzip(names.join('\n'));
            list.entries = names.length;
            list.fetchedAt = list.checkedAt;
            list.lastError = '';
            logs().addInfoLogBasicInfoEntry('Blocklist downloaded: ', list.name, ', ', names.length, ' names');
        } catch (err) {
            list.lastError = String(err.cause?.message || err.message || err).slice(0, 300);
            logs().addErrorLogErrorEntry('Blocklist could not be downloaded: ', list.name, ' - ', list.lastError);
        }
        await list.save();
        return list;
    } finally {
        downloading.delete(id);
    }
}

async function load() {
    const { Blocklist, AllowedName } = models();
    const [lists, allowedNames] = await Promise.all([
        Blocklist.find({ active: true }).select('subdomains fetchedAt checkedAt').lean(),
        AllowedName.find().select('name').lean(),
    ]);

    // The names are read again only when a list or an allowed name differs
    const next = [
        ...lists.map((list) => `${list._id}:${list.subdomains}:${list.fetchedAt?.getTime()}`),
        ...allowedNames.map((entry) => `allow:${entry.name}`),
    ].sort().join();
    if (next !== stamp) {
        const stored = await Blocklist.find({ active: true, fetchedAt: { $ne: null } }).select('+content subdomains').lean();
        const built = [];
        for (const list of stored) {
            // lean() gives the buffer as a Binary of the driver
            const buffer = Buffer.isBuffer(list.content) ? list.content : list.content?.buffer;
            if (buffer?.length) built.push({ subdomains: list.subdomains, names: (await gunzip(buffer)).toString('utf8').split('\n') });
        }
        replace(built, allowedNames.map((entry) => entry.name));
        stamp = next;
        loadedAt = new Date();
        logs().addInfoLogBasicInfoEntry('Blocklists loaded: ', built.length, ', names: ', blocked.size, ', allowed: ', allowed.size);
    }

    // The lists that are due, one at a time
    const now = Date.now();
    const due = lists.find((list) => {
        if (downloading.has(String(list._id))) return false;
        const age = list.fetchedAt ? now - list.fetchedAt.getTime() : Infinity;
        const waited = list.checkedAt ? now - list.checkedAt.getTime() : Infinity;
        return age > config.nsBlocklistRefresh * 3600000 && waited > RETRY_MINUTES * 60000;
    });
    if (due) {
        const list = await Blocklist.findById(due._id);
        if (list) download(list).then(sync, () => {});
    }
}

// Brings the names in memory up to date, and starts the downloads that are
// due. Never rejects: when the database can not be read, the names that are
// in memory stay in use.
function sync() {
    if (running) {
        queued = true;
        return running;
    }
    running = load()
        .then(() => {
            failing = false;
        })
        .catch((err) => {
            if (!failing) logs().addErrorLogErrorEntry('Blocklists could not be loaded: ', err.stack || err);
            failing = true;
        })
        .finally(() => {
            running = null;
            if (queued) {
                queued = false;
                sync();
            }
        });
    return running;
}

// The database has to be connected already
async function start() {
    await sync();
    if (!timer) timer = setInterval(sync, SYNC_SECONDS * 1000).unref();
    return blocked.size;
}

function stop() {
    clearInterval(timer);
    timer = null;
}

module.exports = {
    parseList,
    isBlocked,
    resolve,
    replace,
    download,
    sync,
    start,
    stop,
    state: () => ({
        enabled: config.nsBlockingEnabled,
        mode: config.nsBlockMode,
        lists: listCount,
        names: blocked.size,
        allowed: allowed.size,
        watching: timer !== null,
        failing,
        loadedAt,
    }),
};
