// The standalone records: DNS records that belong to no zone. Mounted at
// /api/records, next to the API of freya-ns-api, and answering in the same
// way. The values are checked with the validators of freya-ns-api, so a
// standalone record holds what a record of a zone holds.
const express = require('express');

const config = require('../../config/config');

const SORTABLE = new Set(['name', 'type', 'ttl', 'active', 'createdAt', 'updatedAt']);
const DEFAULT_TTL = 3600;

// Everything of freya-ns-api and the database is loaded when the API is started
function createService() {
    const mongoose = require('mongoose');
    const validators = require('njord-ns-server/lib/validators');
    const { Zone } = require('freya-ns-api/model/mongoDB/manager');
    const HttpError = require('freya-ns-api/services/httpError');
    const dnsData = require('freya-ns-api/services/dnsService/dnsData');
    const { escapeRegex, parseBoolean, parsePaging, parseSort, findPage } = require('freya-ns-api/services/listQuery');
    const { logService } = require('./apiService');
    const StandaloneRecord = require('../../model/mongoDB/standaloneRecordModel');

    const notFound = () => new HttpError(404, 'Record not found');
    const describe = (record) => `${record.type} ${record.name}`;

    // The owner of the record: a fully qualified name. "*" may be the first label.
    function parseName(value) {
        const name = typeof value === 'string' ? value.trim().toLowerCase().replace(/\.$/, '') : '';
        if (!name) throw dnsData.invalid({ name: 'name is required: a fully qualified name, e.g. nas.home.example' });
        if (name.length > 253 || !validators.nsDomain(name.startsWith('*.') ? name.slice(2) : name)) {
            throw dnsData.invalid({ name: 'name must be a domain name' });
        }
        return name;
    }

    async function findRecord(id) {
        if (!mongoose.isValidObjectId(id)) throw notFound();
        const record = await StandaloneRecord.findById(id);
        if (!record) throw notFound();
        return record;
    }

    // A name inside a zone is answered by the zone, so its records belong
    // there; and a CNAME record must be the only record of its name.
    async function assertPlacement(record) {
        const labels = record.name.replace(/^\*\./, '').split('.');
        const parents = labels.map((label, index) => labels.slice(index).join('.'));
        const zones = await Zone.find({ name: { $in: parents } }).select('name').lean();
        const zone = zones.sort((a, b) => b.name.length - a.name.length)[0];
        if (zone) {
            throw new HttpError(409, `${record.name} is inside the zone ${zone.name}`, {
                name: `This name is inside the zone ${zone.name}: add the record to the zone`,
            });
        }

        const others = { name: record.name, _id: { $ne: record._id } };
        if (record.type !== 'CNAME') {
            if (await StandaloneRecord.exists({ ...others, type: 'CNAME' })) {
                throw new HttpError(409, `${record.name} is a CNAME, and cannot have other records`);
            }
        } else if (await StandaloneRecord.exists(others)) {
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

    // query: { page, limit, type, q, active, sort } - sort is a field name, prefixed with "-" for descending.
    async function listRecords(query = {}) {
        const filter = {};
        if (query.type !== undefined) filter.type = dnsData.parseType(query.type);
        if (query.active !== undefined) filter.active = parseBoolean(query.active, 'active');
        if (typeof query.q === 'string' && query.q.trim()) {
            const pattern = new RegExp(escapeRegex(query.q.trim()), 'i');
            filter.$or = [{ name: pattern }, { 'data.target': pattern }, { 'data.exchange': pattern }];
        }
        return findPage(StandaloneRecord, filter, parsePaging(query), parseSort(query, SORTABLE, 'name'), StandaloneRecord.toPublic);
    }

    // data: { name, type, data, ttl?, active? }
    async function createRecord(data, actor) {
        dnsData.assertOnly(data, ['name', 'type', 'data', 'ttl', 'active']);

        const type = dnsData.parseType(data.type);
        const record = new StandaloneRecord({
            name: parseName(data.name),
            type,
            ttl: dnsData.parseTtl(data.ttl) ?? DEFAULT_TTL,
            data: dnsData.parseRecordData(type, data.data),
        });
        if (data.active !== undefined) record.active = dnsData.parseActive(data.active);

        await assertPlacement(record);
        await save(record);
        logService.addInfoLogBasicInfoEntry('Standalone DNS record created: ', describe(record), ' by ', actor?.username);
        return record.toJSON();
    }

    // data: { name?, data?, ttl?, active? } - the fields of data that are left out keep their value.
    async function updateRecord(id, data, actor) {
        if (dnsData.isObject(data) && 'type' in data) {
            throw new HttpError(400, 'The type of a record cannot be changed; delete it and create a new one');
        }
        dnsData.assertOnly(data, ['name', 'data', 'ttl', 'active']);
        if (!Object.keys(data).length) throw new HttpError(400, 'No fields to update');

        const record = await findRecord(id);
        if (data.name !== undefined) record.name = parseName(data.name);
        if (data.ttl !== undefined) record.ttl = dnsData.parseTtl(data.ttl) ?? DEFAULT_TTL;
        if (data.active !== undefined) record.active = dnsData.parseActive(data.active);
        if (data.data !== undefined) {
            if (!dnsData.isObject(data.data)) throw dnsData.invalid({ data: 'data must be an object' });
            record.data = dnsData.parseRecordData(record.type, { ...record.data, ...data.data });
        }

        if (record.isModified('name')) await assertPlacement(record);
        await save(record);
        logService.addInfoLogBasicInfoEntry('Standalone DNS record updated: ', describe(record), ' by ', actor?.username);
        return record.toJSON();
    }

    async function deleteRecord(id, actor) {
        const record = await findRecord(id);
        await record.deleteOne();
        logService.addInfoLogBasicInfoEntry('Standalone DNS record deleted: ', describe(record), ' by ', actor?.username);
    }

    return { findRecord, listRecords, createRecord, updateRecord, deleteRecord };
}

function createRouter() {
    const { authenticate, requireRole } = require('freya-ns-api/services/authService/authService');
    const { finish, prepare } = require('./serviceRoutes');
    const service = createService();

    const router = prepare(express.Router());
    // Every signed-in user may read the records; only these roles may change them, as with the zones
    const canWrite = requireRole(...config.dnsWriteRoles);

    router.use(authenticate);

    router.get('/', async (req, res) => {
        res.json(await service.listRecords(req.query));
    });

    router.post('/', canWrite, async (req, res) => {
        const record = await service.createRecord(req.body, req.user);
        res.status(201).location(`${req.baseUrl}/${record.id}`).json(record);
    });

    router.get('/:recordId', async (req, res) => {
        res.json((await service.findRecord(req.params.recordId)).toJSON());
    });

    router.patch('/:recordId', canWrite, async (req, res) => {
        res.json(await service.updateRecord(req.params.recordId, req.body, req.user));
    });

    router.delete('/:recordId', canWrite, async (req, res) => {
        await service.deleteRecord(req.params.recordId, req.user);
        res.status(204).end();
    });

    return finish(router);
}

module.exports = { createRouter };
