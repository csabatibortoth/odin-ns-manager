const dns = require('dns');

// DNS-01 provider "zones": when the name belongs to a zone of THIS server, the TXT record of the challenge is
// written into that zone. No account, no credentials. It can create and delete one kind of record only:
// a TXT record named _acme-challenge.<something>, marked transient. Nothing else of the zones is reachable from here.
//
// A transient record
//   - is answered by the name server like any record (the zone is marked as changed),
//   - does not raise the serial of the zone: a secondary does not copy it (only this server is asked, see the README),
//   - is left out of the record lists, the export and the backup,
//   - is deleted when the server starts, so a crash cannot leave one behind.

const PREFIX = '_acme-challenge.';
// The value of a challenge is base64url(SHA-256(...)): 43 characters. Nothing else is written.
const VALUE = /^[A-Za-z0-9_-]{43}$/;
const TTL = 60;

// What the host program (Odin) lends to this provider:
//   onChange()  the name server must read the zones again, now
//   resolver    { address, port } of the name server of this process, to see that a record is answered
const host = { onChange: () => {}, resolver: null };
const configure = (options = {}) => Object.assign(host, { onChange: () => {}, resolver: null }, options);

// Required late: the models connect to nothing until used, and a program that does not use this provider never loads them.
const models = () => require('../../model/mongoDB/manager');

const suffixes = (name) => {
    const parts = name.split('.');
    return parts.map((_, at) => parts.slice(at).join('.')).slice(0, -1);
};

function checkName(name, value) {
    if (typeof name !== 'string' || !name.startsWith(PREFIX) || name.length <= PREFIX.length) {
        throw new Error(`Only names that start with ${PREFIX} can be written: ${name}`);
    }
    if (value !== undefined && !VALUE.test(value)) throw new Error('The value of a challenge record has the wrong form');
}

// The zone that holds the name: the longest of the active zones whose name the name ends with.
async function zoneFor(name, { Zone } = models()) {
    const zones = await Zone.find({ name: { $in: suffixes(name) }, active: true }).lean();
    if (!zones.length) {
        throw new Error(
            `${name} does not belong to a zone of this server, so the record cannot be written here. ` +
                'Create the zone, or let the name be delegated to one (CNAME delegation).'
        );
    }
    return zones.reduce((best, zone) => (zone.name.length > best.name.length ? zone : best));
}

// The name server reads a zone again when its stamp (serial + modification time) differs: only the time is changed.
async function touch(zone, { Zone } = models()) {
    await Zone.updateOne({ _id: zone._id }, { $set: { updatedAt: new Date() } });
    host.onChange();
}

async function create(name, value, db = models()) {
    checkName(name, value);
    const zone = await zoneFor(name, db);
    if (await db.Record.exists({ name, type: 'CNAME' })) {
        throw new Error(`${name} is a CNAME, so a TXT record cannot be written there`);
    }
    try {
        await db.Record.create({ zone: zone._id, name, type: 'TXT', ttl: TTL, data: { target: value }, active: true, transient: true });
    } catch (err) {
        // The same record is already there (a retry): that is what was wanted.
        if (err.code !== 11000) throw err;
    }
    await touch(zone, db);
}

async function remove(name, value, db = models()) {
    checkName(name, value);
    // Only a transient record: a record a person made is never deleted from here.
    const gone = await db.Record.deleteOne({ name, type: 'TXT', 'data.target': value, transient: true });
    if (!gone.deletedCount) return;
    const zone = await zoneFor(name, db).catch(() => null);
    if (zone) await touch(zone, db);
}

// Is the record answered? Asks the name server of this process, over UDP, as the authority would.
async function visible(name, value, db = models()) {
    if (!host.resolver) return Boolean(await db.Record.exists({ name, type: 'TXT', 'data.target': value, transient: true }));
    const resolver = new dns.promises.Resolver({ timeout: 2000, tries: 1 });
    resolver.setServers([`${host.resolver.address}:${host.resolver.port}`]);
    const answers = await resolver.resolveTxt(name).catch(() => []);
    return answers.some((chunks) => chunks.join('') === value);
}

// At start: no challenge outlives the process that made it.
async function removeLeftovers(db = models()) {
    const zones = await db.Record.distinct('zone', { transient: true });
    const gone = await db.Record.deleteMany({ transient: true });
    for (const _id of zones.filter(Boolean)) await touch({ _id }, db);
    return gone.deletedCount;
}

const provider = () => ({ create, remove, visible });

module.exports = { configure, provider, removeLeftovers, zoneFor, suffixes, PREFIX };
