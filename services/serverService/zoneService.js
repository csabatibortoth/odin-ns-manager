// Answers the queries for the names of our own zones: the zones and records
// that are managed through the API (freya-ns-api) and stored in MongoDB. The
// standalone records of the API, which belong to no zone, are answered here as well.
//
// - The active zones are kept in memory, so a query never waits for the database.
// - Every change raises the serial of its zone; a zone is read again when its
//   serial or its modification time differs from what is in memory.
// - The database is checked every nsZoneRefresh seconds, and right after a
//   change that is made through the API of this process.
const named = require('njord-ns-server');
const config = require('../../config/config');
const searchService = require('./searchService');

const MAX_CNAME_HOPS = 8;

const cleanName = (name) => name.toLowerCase().replace(/\.$/, '');
const parentOf = (name) => name.slice(name.indexOf('.') + 1);

let zones = new Map(); // name of the zone -> zone, as built by buildZone
let standalone = { nodes: new Map(), records: 0, skipped: [] }; // as built by buildStandalone

// The stored data holds the constructor arguments of the record classes of njord-ns-server
function toRecord(type, data) {
    if (type === 'MX') return new named.MXRecord(data.exchange, data);
    if (type === 'SRV') return new named.SRVRecord(data.target, data.port, data);
    if (!['A', 'AAAA', 'CNAME', 'NS', 'PTR', 'TXT'].includes(type)) throw new Error(`unknown record type ${type}`);
    return new named[`${type}Record`](data.target);
}

// zone and records are the plain documents of the database. Returns the zone
// in the form the lookups use; `skipped` lists the records that can not be served.
function buildZone(zone, records, stamp = '') {
    const nodes = new Map(); // name -> Map of type -> [{ record, ttl }]
    const names = new Set(); // every name that exists, also the ones without records of their own
    const skipped = [];

    const add = (name, type, record, ttl) => {
        if (!nodes.has(name)) nodes.set(name, new Map());
        const node = nodes.get(name);
        if (!node.has(type)) node.set(type, []);
        node.get(type).push({ record, ttl });
        for (let rest = name; !names.has(rest) && rest.length >= zone.name.length; rest = parentOf(rest)) names.add(rest);
    };

    add(zone.name, 'SOA', new named.SOARecord(zone.soa.host, zone.soa), zone.soa.ttl);
    for (const { name, type, data, ttl } of records) {
        try {
            add(name, type, toRecord(type, data), ttl ?? zone.ttl);
        } catch (err) {
            skipped.push(`${type} ${name}: ${err.message}`);
        }
    }

    return { name: zone.name, stamp, nodes, names, skipped, records: records.length - skipped.length };
}

function replaceZones(list) {
    zones = new Map(list.map((zone) => [zone.name, zone]));
}

// records are the plain documents of the standalone records. Returns them in
// the form the lookups use: name -> Map of type -> [{ record, ttl }].
function buildStandalone(records) {
    const nodes = new Map();
    const skipped = [];
    for (const { name, type, data, ttl } of records) {
        try {
            const record = toRecord(type, data);
            if (!nodes.has(name)) nodes.set(name, new Map());
            const node = nodes.get(name);
            if (!node.has(type)) node.set(type, []);
            node.get(type).push({ record, ttl: ttl ?? 3600 });
        } catch (err) {
            skipped.push(`${type} ${name}: ${err.message}`);
        }
    }
    return { nodes, skipped, records: records.length - skipped.length };
}

function replaceStandalone(built) {
    standalone = built;
}

// The standalone records of a name: its own, or the ones of the closest
// wildcard above it.
function findStandalone(name) {
    let node = standalone.nodes.get(name);
    for (let rest = name; !node && rest.includes('.'); ) {
        rest = parentOf(rest);
        node = standalone.nodes.get(`*.${rest}`);
    }
    return node;
}

// The zone a name belongs to: the one with the longest matching name
function findZone(name) {
    for (let rest = name; ; rest = parentOf(rest)) {
        const zone = zones.get(rest);
        if (zone || !rest.includes('.')) return zone;
    }
}

// The records of a name in its zone: null when the name does not exist, and
// its CNAME record when it is an alias and has no records of the type itself.
function lookup(zone, name, type) {
    let node = zone.nodes.get(name);
    if (!node && !zone.names.has(name)) {
        // A wildcard only stands for the names below the closest name that exists
        let encloser = parentOf(name);
        while (!zone.names.has(encloser)) encloser = parentOf(encloser);
        node = zone.nodes.get(`*.${encloser}`);
        if (!node) return null;
    }
    if (!node) return [];
    return node.get(type) || node.get('CNAME') || [];
}

// What we hold for a name: { source: 'zones' | 'records', found } - found as
// lookup returns it - or null when the name is not ours. A zone comes before
// the standalone records, which are for the names outside of the zones.
function own(name, type) {
    const zone = findZone(name);
    if (zone) return { source: 'zones', found: lookup(zone, name, type) };
    const node = findStandalone(name);
    // The name is ours with all of its types: the ones it has no record of are not forwarded
    if (node) return { source: 'records', found: node.get(type) || node.get('CNAME') || [] };
    return null;
}

// Answers a query of the server when its name is in one of our zones, or has
// standalone records. Returns where the answer is from, 'zones' or 'records';
// or false when the name is not ours, and the query is left for the upstream lookup.
async function resolve(query) {
    const type = query.type();
    let owner = query.name();
    let name = cleanName(owner);
    let held = own(name, type);
    if (!held) return false;
    const { source } = held;

    query._flags.aa = true; // the answer is our own
    query._flags.ra = true;
    if (type === 'AXFR') {
        query.setError('erefuse'); // zone transfers are not offered
        return source;
    }

    for (let hop = 0; hop <= MAX_CNAME_HOPS; hop++) {
        const { found } = held;
        if (found === null) {
            if (hop === 0) query.setError('enoname');
            return source;
        }
        for (const answer of found) query.addAnswer(owner, answer.record, answer.ttl);

        // An alias is followed, so the client gets the records it asked for as well
        const alias = type !== 'CNAME' && found[0]?.record._type === 'CNAME' ? found[0].record.target : null;
        if (!alias) return source;

        owner = alias;
        name = cleanName(alias);
        held = own(name, type);
        if (!held) {
            try {
                for (const answer of await searchService.search(name, type)) query.addAnswer(owner, answer.record, answer.ttl);
            } catch {
                // The alias itself is still a valid answer
            }
            return source;
        }
    }
    return source;
}

///--- Loading from the database

// Required late: freya-ns-api reads its settings when it is first loaded, and
// the lookups above have to work without a database.
const logs = () => require('../apiService/apiService').logService;
const models = () => {
    require('../apiService/apiService');
    return require('freya-ns-api/model/mongoDB/manager');
};

let running = null;
let queued = false;
let timer = null;
let failing = false;
let checkedAt = null; // the last time the database was read
let changedAt = null; // the last time that brought a change
let standaloneStamp = '';

async function load() {
    const { Zone, Record } = models();
    const stored = await Zone.find({ active: true }).lean();

    const next = [];
    const changed = new Map(); // id -> { zone, stamp, records }
    for (const zone of stored) {
        const stamp = `${zone._id}:${zone.soa.serial}:${zone.updatedAt?.getTime()}`;
        const current = zones.get(zone.name);
        if (current?.stamp === stamp) next.push(current);
        else changed.set(String(zone._id), { zone, stamp, records: [] });
    }

    if (changed.size) {
        const records = await Record.find({ zone: { $in: [...changed.values()].map(({ zone }) => zone._id) }, active: true }).lean();
        for (const record of records) changed.get(String(record.zone)).records.push(record);

        for (const { zone, stamp, records: own } of changed.values()) {
            const built = buildZone(zone, own, stamp);
            for (const reason of built.skipped) logs().addErrorLogErrorEntry(`DNS record of ${zone.name} is not served - `, reason);
            next.push(built);
        }
    }

    // The standalone records are the records without a zone. They are few: they
    // are read whole, and built again when one of them differs
    const loose = await Record.find({ zone: null, active: true }).lean();
    const stamp = loose.map((record) => `${record._id}:${record.updatedAt?.getTime()}`).sort().join();
    const standaloneChanged = stamp !== standaloneStamp;
    if (standaloneChanged) {
        const built = buildStandalone(loose);
        for (const reason of built.skipped) logs().addErrorLogErrorEntry('Standalone DNS record is not served - ', reason);
        replaceStandalone(built);
        standaloneStamp = stamp;
    }

    const removed = next.length < zones.size + changed.size;
    replaceZones(next);
    checkedAt = new Date();
    if (changed.size || removed || standaloneChanged) {
        changedAt = checkedAt;
        logs().addInfoLogBasicInfoEntry(
            'DNS zones loaded: ', next.length, ', changed: ', [...changed.values()].map(({ zone }) => zone.name).join(', ') || '-',
            ', standalone records: ', standalone.records
        );
    }
}

// Brings the zones in memory up to date. Never rejects: when the database can
// not be read, the zones that are in memory are served on, and the failure is
// logged once.
function refresh() {
    if (running) {
        queued = true; // something changed while reading: read once more
        return running;
    }
    running = load()
        .then(() => {
            failing = false;
        })
        .catch((err) => {
            if (!failing) logs().addErrorLogErrorEntry('DNS zones could not be loaded: ', err.stack || err);
            failing = true;
        })
        .finally(() => {
            running = null;
            if (queued) {
                queued = false;
                refresh();
            }
        });
    return running;
}

// Loads the zones, and keeps them up to date from then on. The database has
// to be connected already.
async function start() {
    await refresh();
    if (!timer) timer = setInterval(refresh, config.nsZoneRefresh * 1000).unref();
    return zones.size;
}

function stop() {
    clearInterval(timer);
    timer = null;
}

// The time between two checks of the database can be changed while the server runs
config.onChange((keys) => {
    if (timer && keys.includes('nsZoneRefresh')) {
        stop();
        timer = setInterval(refresh, config.nsZoneRefresh * 1000).unref();
    }
});

module.exports = {
    resolve,
    refresh,
    start,
    stop,
    buildZone,
    replaceZones,
    buildStandalone,
    replaceStandalone,
    zoneCount: () => zones.size,
    // The name of the zone that answers for a name, if it is one of ours
    zoneOf: (name) => findZone(cleanName(name))?.name ?? null,
    // Is the name answered from the standalone records?
    isStandalone: (name) => !findZone(cleanName(name)) && Boolean(findStandalone(cleanName(name))),
    state: () => ({
        zones: zones.size,
        records: [...zones.values()].reduce((sum, zone) => sum + zone.records, 0),
        standalone: standalone.records,
        watching: timer !== null,
        failing,
        checkedAt,
        changedAt,
    }),
};
