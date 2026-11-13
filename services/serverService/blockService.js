// Blocks the names of the blocking of freya-ns-api: the block lists, such as
// https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts, which the
// API downloads and keeps in MongoDB, and the block rules that are set by hand.
// The queries are answered from memory.
//
// - A blocked name is not looked up at the upstream. It is answered with the
//   address 0.0.0.0 (and ::), or with "no such name": the mode of the blocking.
// - The own zones and standalone records come first.
// - A name is decided the way `check` of freya-ns-api decides it: the rule of
//   the name itself, or else of the nearest domain above it that includes its
//   subdomains; without a rule, the active block lists that hold the name.
// - A list is downloaded again every nsBlocklistRefresh hours. When that
//   fails, the names of the last download stay in use.
const named = require('njord-ns-server');
const config = require('../../config/config');

const SYNC_SECONDS = 15; // between two looks at the database
const RETRY_MINUTES = 15; // after a download that failed
const BLOCKED_TTL = 300;

const cleanName = (name) => name.toLowerCase().replace(/\.$/, '');
const parentOf = (name) => name.slice(name.indexOf('.') + 1);

let settings = { enabled: true, mode: 'NULL_IP' };
let blocked = new Set(); // the names of the active lists
let rules = new Map(); // domain -> { block, below }: block or allow, and whether the names below it as well
let listCount = 0;

///--- The decision

// The rule that decides a name: its own, or the nearest one above it that includes its subdomains
function ruleOf(name) {
    if (!rules.size) return null;
    for (let rest = name; ; rest = parentOf(rest)) {
        const rule = rules.get(rest);
        if (rule && (rest === name || rule.below)) return rule;
        if (!rest.includes('.')) return null;
    }
}

// Why a name is blocked: 'rule' or 'list'; null when it is not
function reason(name) {
    if (!settings.enabled) return null;
    name = cleanName(name);
    const rule = ruleOf(name);
    if (rule) return rule.block ? 'rule' : null;
    return blocked.has(name) ? 'list' : null;
}

const isBlocked = (name) => reason(name) !== null;

// Answers a query of the server when its name is blocked. Returns false when
// it is not, and the query is left for the upstream lookup.
function resolve(query) {
    const name = query.name();
    if (!isBlocked(name)) return false;

    query._flags.ra = true;
    if (settings.mode === 'NXDOMAIN') query.setError('enoname');
    else if (query.type() === 'A') query.addAnswer(name, new named.ARecord('0.0.0.0'), BLOCKED_TTL);
    else if (query.type() === 'AAAA') query.addAnswer(name, new named.AAAARecord('::'), BLOCKED_TTL);
    // The other types get an empty answer
    return true;
}

// next: { settings?: { enabled, mode }, names?: iterable of the names of the lists, lists?: their number,
//         rules?: [{ domain, action, includeSubdomains }] } - what is left out stays as it is
function replace(next = {}) {
    if (next.settings) settings = { enabled: next.settings.enabled !== false, mode: next.settings.mode === 'NXDOMAIN' ? 'NXDOMAIN' : 'NULL_IP' };
    if (next.names) blocked = next.names instanceof Set ? next.names : new Set(next.names);
    if (next.lists !== undefined) listCount = next.lists;
    if (next.rules) {
        rules = new Map(next.rules.map((rule) => [rule.domain, { block: rule.action === 'block', below: Boolean(rule.includeSubdomains) }]));
    }
}

///--- The database and the downloads

// Required late: freya-ns-api reads its settings when it is first loaded (see
// apiService), and the lookups above have to work without a database.
const logs = () => require('../apiService/apiService').logService;
const models = () => {
    require('../apiService/apiService');
    return require('freya-ns-api/model/mongoDB/manager');
};
const listService = () => {
    require('../apiService/apiService');
    return require('freya-ns-api/services/blockingService/blockListService');
};

let listStamp = null;
let running = null;
let queued = false;
let timer = null;
let failing = false;
let loadedAt = null;
let downloading = false;

async function load() {
    const { BlockList, BlockEntry, BlockRule, BlockSettings } = models();
    const [stored, lists, storedRules] = await Promise.all([
        BlockSettings.findById(BlockSettings.ID).lean(),
        BlockList.find({ active: true }).select('status refreshedAt entryCount updatedAt').lean(),
        BlockRule.find({ active: true }).select('domain action includeSubdomains').lean(),
    ]);

    // The settings and the rules are few: they are taken as they are
    replace({ settings: stored ?? { enabled: true, mode: 'NULL_IP' }, rules: storedRules });

    // The names are read again only when a list was downloaded, added or removed
    const stamp = lists.map((list) => `${list._id}:${list.refreshedAt?.getTime()}:${list.entryCount}`).sort().join();
    if (stamp !== listStamp) {
        const names = new Set();
        if (lists.length) {
            const entries = BlockEntry.find({ list: { $in: lists.map((list) => list._id) } }).select('domain -_id').lean().cursor();
            for await (const entry of entries) names.add(entry.domain);
        }
        replace({ names, lists: lists.length });
        listStamp = stamp;
        loadedAt = new Date();
        logs().addInfoLogBasicInfoEntry('Block lists loaded: ', lists.length, ', names: ', names.size, ', rules: ', rules.size);
    }

    // The lists that are due, one at a time. The API downloads a list itself
    // when it is added; asking for it here waits for that download.
    if (downloading) return;
    const now = Date.now();
    const due = lists.find((list) => {
        if (list.status === 'pending') return true;
        const age = list.refreshedAt ? now - list.refreshedAt.getTime() : Infinity;
        const waited = list.updatedAt ? now - list.updatedAt.getTime() : Infinity;
        return age > config.nsBlocklistRefresh * 3600000 && waited > RETRY_MINUTES * 60000;
    });
    if (due) {
        downloading = true;
        listService()
            .refreshList(String(due._id))
            .catch(() => {}) // deleted meanwhile; a failed download is recorded with the list
            .finally(() => {
                downloading = false;
                sync();
            });
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
            if (!failing) logs().addErrorLogErrorEntry('Block lists could not be loaded: ', err.stack || err);
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
    isBlocked,
    reason,
    resolve,
    replace,
    sync,
    start,
    stop,
    state: () => ({
        enabled: settings.enabled,
        mode: settings.mode,
        lists: listCount,
        names: blocked.size,
        rules: rules.size,
        watching: timer !== null,
        failing,
        loadedAt,
    }),
};
