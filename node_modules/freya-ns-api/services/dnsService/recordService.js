const mongoose = require('mongoose');

const Record = require('../../model/mongoDB/recordModel');
const HttpError = require('../httpError');
const { escapeRegex, parseBoolean, parsePaging, parseSort, findPage } = require('../listQuery');
const logService = require('../logService/logService');
const dnsData = require('./dnsData');
const zoneService = require('./zoneService');

const SORTABLE = new Set(['name', 'type', 'ttl', 'active', 'createdAt', 'updatedAt']);

const notFound = () => new HttpError(404, 'Record not found');
const describe = (record) => `${record.type} ${record.name}`;

async function findRecord(zoneId, recordId) {
    if (!mongoose.isValidObjectId(zoneId) || !mongoose.isValidObjectId(recordId)) throw notFound();
    const record = await Record.findOne({ _id: recordId, zone: zoneId });
    if (!record) throw notFound();
    return record;
}

// A CNAME record must be the only record of its name, and the zone itself always has a SOA record.
async function assertPlacement(zone, record) {
    const others = { zone: zone._id, name: record.name, _id: { $ne: record._id } };

    if (record.type !== 'CNAME') {
        if (await Record.exists({ ...others, type: 'CNAME' })) {
            throw new HttpError(409, `${record.name} is a CNAME, and cannot have other records`);
        }
        return;
    }
    if (record.name === zone.name) throw dnsData.invalid({ name: 'A CNAME record cannot be placed at the zone itself' });
    if (await Record.exists(others)) {
        throw new HttpError(409, `${record.name} already has records, and cannot be a CNAME as well`);
    }
}

async function save(record) {
    try {
        await record.save();
    } catch (err) {
        if (err.code === 11000) throw new HttpError(409, 'An identical record already exists');
        throw err;
    }
}

// query: { page, limit, type, name, q, active, sort } - sort is a field name, prefixed with "-" for descending.
async function listRecords(zoneId, query = {}) {
    const zone = await zoneService.findZone(zoneId);

    const filter = { zone: zone._id };
    if (query.type !== undefined) filter.type = dnsData.parseType(query.type);
    if (query.name !== undefined) filter.name = dnsData.parseOwnerName(query.name, zone.name);
    if (query.active !== undefined) filter.active = parseBoolean(query.active, 'active');
    if (typeof query.q === 'string' && query.q.trim()) {
        const pattern = new RegExp(escapeRegex(query.q.trim()), 'i');
        filter.$or = [{ name: pattern }, { 'data.target': pattern }, { 'data.exchange': pattern }];
    }

    return findPage(Record, filter, parsePaging(query), parseSort(query, SORTABLE, 'name'), Record.toPublic);
}

async function getRecord(zoneId, recordId) {
    return (await findRecord(zoneId, recordId)).toJSON();
}

// data: { name, type, data, ttl?, active? }
async function createRecord(zoneId, data, actor) {
    dnsData.assertOnly(data, ['name', 'type', 'data', 'ttl', 'active']);
    const zone = await zoneService.findZone(zoneId);

    const type = dnsData.parseType(data.type);
    const record = new Record({
        zone: zone._id,
        name: dnsData.parseOwnerName(data.name, zone.name),
        type,
        ttl: dnsData.parseTtl(data.ttl),
        data: dnsData.parseRecordData(type, data.data),
    });
    if (data.active !== undefined) record.active = dnsData.parseActive(data.active);

    await assertPlacement(zone, record);
    await save(record);
    await zoneService.bumpSerial(zone._id);
    logService.addInfoLogBasicInfoEntry('DNS record created: ', describe(record), ' by ', actor?.username);
    return record.toJSON();
}

// data: { name?, data?, ttl?, active? } - the fields of data that are left out keep their value.
async function updateRecord(zoneId, recordId, data, actor) {
    if (dnsData.isObject(data) && 'type' in data) {
        throw new HttpError(400, 'The type of a record cannot be changed; delete it and create a new one');
    }
    dnsData.assertOnly(data, ['name', 'data', 'ttl', 'active']);
    if (!Object.keys(data).length) throw new HttpError(400, 'No fields to update');

    const record = await findRecord(zoneId, recordId);
    const zone = await zoneService.findZone(zoneId);

    if (data.name !== undefined) record.name = dnsData.parseOwnerName(data.name, zone.name);
    if (data.ttl !== undefined) record.ttl = dnsData.parseTtl(data.ttl);
    if (data.active !== undefined) record.active = dnsData.parseActive(data.active);
    if (data.data !== undefined) {
        if (!dnsData.isObject(data.data)) throw dnsData.invalid({ data: 'data must be an object' });
        record.data = dnsData.parseRecordData(record.type, { ...record.data, ...data.data });
    }

    if (record.isModified('name')) await assertPlacement(zone, record);
    await save(record);
    await zoneService.bumpSerial(zone._id);
    logService.addInfoLogBasicInfoEntry('DNS record updated: ', describe(record), ' by ', actor?.username);
    return record.toJSON();
}

async function deleteRecord(zoneId, recordId, actor) {
    const record = await findRecord(zoneId, recordId);
    await record.deleteOne();
    await zoneService.bumpSerial(record.zone);
    logService.addInfoLogBasicInfoEntry('DNS record deleted: ', describe(record), ' by ', actor?.username);
}

module.exports = {
    listRecords,
    getRecord,
    createRecord,
    updateRecord,
    deleteRecord,
};
