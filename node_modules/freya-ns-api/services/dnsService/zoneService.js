const mongoose = require('mongoose');

const Record = require('../../model/mongoDB/recordModel');
const Zone = require('../../model/mongoDB/zoneModel');
const HttpError = require('../httpError');
const { escapeRegex, parseBoolean, parsePaging, parseSort, findPage } = require('../listQuery');
const logService = require('../logService/logService');
const dnsData = require('./dnsData');

const SORTABLE = new Set(['name', 'active', 'ttl', 'createdAt', 'updatedAt']);
const MAX_SERIAL = 0xffffffff;

const notFound = () => new HttpError(404, 'Zone not found');

// The customary serial of a zone: the date followed by a two digit counter, e.g. 2026111200.
const dateSerial = () => Number(new Date().toISOString().slice(0, 10).replaceAll('-', '')) * 100;

async function findZone(id) {
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const zone = await Zone.findById(id);
    if (!zone) throw notFound();
    return zone;
}

// Raises the serial of the zone, which is how secondaries learn that it changed. Returns the zone.
async function bumpSerial(zoneId) {
    const next = { $max: [{ $add: ['$soa.serial', 1] }, dateSerial()] };
    const zone = await Zone.findOneAndUpdate(
        { _id: zoneId },
        [{ $set: { 'soa.serial': { $cond: [{ $gt: [next, MAX_SERIAL] }, 1, next] }, updatedAt: '$$NOW' } }],
        { returnDocument: 'after', updatePipeline: true, timestamps: false }
    ).lean();
    return zone && Zone.toPublic(zone);
}

// query: { page, limit, q, active, sort } - sort is a field name, prefixed with "-" for descending.
async function listZones(query = {}) {
    const filter = {};
    if (query.active !== undefined) filter.active = parseBoolean(query.active, 'active');
    if (typeof query.q === 'string' && query.q.trim()) filter.name = new RegExp(escapeRegex(query.q.trim()), 'i');

    return findPage(Zone, filter, parsePaging(query), parseSort(query, SORTABLE, 'name'), Zone.toPublic);
}

async function getZone(id) {
    return (await findZone(id)).toJSON();
}

// data: { name, soa: { host, admin?, serial?, refresh?, retry?, expire?, ttl? }, ttl?, active? }
async function createZone(data, actor) {
    dnsData.assertOnly(data, ['name', 'soa', 'ttl', 'active']);

    const name = dnsData.parseZoneName(data.name);
    const zone = new Zone({
        name,
        soa: dnsData.parseSoa({
            admin: `hostmaster.${name}`,
            serial: dateSerial(),
            ...(dnsData.isObject(data.soa) ? data.soa : { host: undefined }),
        }),
    });
    if (data.ttl != null) zone.ttl = dnsData.parseTtl(data.ttl);
    if (data.active !== undefined) zone.active = dnsData.parseActive(data.active);

    await zone.save();
    logService.addInfoLogBasicInfoEntry('DNS zone created: ', zone.name, ' by ', actor?.username);
    return zone.toJSON();
}

// data: { soa?, ttl?, active? } - the fields of soa that are left out keep their value.
async function updateZone(id, data, actor) {
    if (dnsData.isObject(data) && 'name' in data) {
        throw new HttpError(400, 'A zone cannot be renamed; create a new zone instead');
    }
    dnsData.assertOnly(data, ['soa', 'ttl', 'active']);
    if (!Object.keys(data).length) throw new HttpError(400, 'No fields to update');

    const zone = await findZone(id);
    if (data.soa !== undefined) {
        if (!dnsData.isObject(data.soa)) throw dnsData.invalid({ soa: 'soa must be an object' });
        zone.soa = dnsData.parseSoa({ ...zone.toObject().soa, ...data.soa });
    }
    if (data.ttl != null) zone.ttl = dnsData.parseTtl(data.ttl);
    if (data.active !== undefined) zone.active = dnsData.parseActive(data.active);
    await zone.save();
    logService.addInfoLogBasicInfoEntry('DNS zone updated: ', zone.name, ' by ', actor?.username);

    // A serial that is set by hand is kept as it is.
    return data.soa?.serial === undefined ? bumpSerial(zone._id) : zone.toJSON();
}

// Deletes the zone together with all of its records.
async function deleteZone(id, actor) {
    const zone = await findZone(id);
    const { deletedCount } = await Record.deleteMany({ zone: zone._id });
    await zone.deleteOne();
    logService.addInfoLogBasicInfoEntry(
        'DNS zone deleted: ', zone.name, ' with ', deletedCount, ' record(s) by ', actor?.username
    );
}

module.exports = {
    findZone,
    bumpSerial,
    listZones,
    getZone,
    createZone,
    updateZone,
    deleteZone,
};
