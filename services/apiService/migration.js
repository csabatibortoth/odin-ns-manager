// Carries the data of the releases before 2.3.0 over to freya-ns-api 2.3,
// which brought its own standalone records and blocking. Until then this
// server kept them itself, in a different form:
//
// - standalonerecords       -> the records without a zone, in `records`
// - blocklists (same name!) -> the block lists; their names are downloaded again
// - allowednames            -> block rules that allow the name and what is below it
// - the nsBlockingEnabled and nsBlockMode settings -> the settings of the blocking
//
// Every step leaves alone what is carried over already, so it is safe to run
// at every start. It works on the collections themselves, as the models of
// the old data are gone.
const config = require('../../config/config');

async function exists(db, name) {
    return (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
}

async function standaloneRecords(db) {
    if (!(await exists(db, 'standalonerecords'))) return null;
    const records = db.collection('records');
    let moved = 0;
    for await (const old of db.collection('standalonerecords').find()) {
        const { name, type, data } = old;
        if (!(await records.findOne({ zone: null, name, type, data }))) {
            await records.insertOne({
                zone: null, name, type, data, ttl: old.ttl ?? null, active: old.active !== false,
                createdAt: old.createdAt ?? new Date(), updatedAt: new Date(), __v: 0,
            });
            moved++;
        }
    }
    await db.collection('standalonerecords').drop();
    return `${moved} standalone record(s)`;
}

// The old lists live in the collection the new ones use: they are told apart by the fields only they have
async function blockLists(db) {
    const lists = db.collection('blocklists');
    const old = { $or: [{ content: { $exists: true } }, { fetchedAt: { $exists: true } }, { entries: { $exists: true } }, { status: { $exists: false } }] };
    const { modifiedCount } = await lists.updateMany(old, {
        $set: { status: 'pending', lastError: null, refreshedAt: null, entryCount: 0 },
        $unset: { content: '', entries: '', fetchedAt: '', checkedAt: '', subdomains: '' },
    });
    if (modifiedCount) await lists.updateMany({ description: { $exists: false } }, { $set: { description: '' } });
    return modifiedCount ? `${modifiedCount} block list(s), which are downloaded again` : null;
}

async function allowedNames(db) {
    if (!(await exists(db, 'allowednames'))) return null;
    const rules = db.collection('blockrules');
    let moved = 0;
    for await (const old of db.collection('allowednames').find()) {
        if (!(await rules.findOne({ domain: old.name }))) {
            const now = new Date();
            await rules.insertOne({
                domain: old.name, action: 'allow', includeSubdomains: true, comment: old.note || '', active: true,
                createdAt: old.createdAt ?? now, updatedAt: now, __v: 0,
            });
            moved++;
        }
    }
    await db.collection('allowednames').drop();
    return `${moved} allowed name(s)`;
}

// Only while the blocking has no settings of its own yet
async function blockSettings(db) {
    const { nsBlockingEnabled, nsBlockMode } = config.legacy;
    if (nsBlockingEnabled === undefined && nsBlockMode === undefined) return null;
    const settings = db.collection('blocksettings');
    if (await settings.findOne({ _id: 'blocking' })) return null;

    const now = new Date();
    await settings.insertOne({
        _id: 'blocking', enabled: nsBlockingEnabled !== false, mode: nsBlockMode === 'nxdomain' ? 'NXDOMAIN' : 'NULL_IP',
        createdAt: now, updatedAt: now, __v: 0,
    });
    return 'the settings of the blocking';
}

// connection: the connection of mongoose. Returns what was carried over, as texts.
async function migrate(connection) {
    const { db } = connection;
    const done = [];
    for (const step of [standaloneRecords, blockLists, allowedNames, blockSettings]) {
        const result = await step(db);
        if (result) done.push(result);
    }
    return done;
}

module.exports = { migrate };
