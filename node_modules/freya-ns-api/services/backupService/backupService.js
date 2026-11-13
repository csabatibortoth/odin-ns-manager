// Moves the configuration of a system to another one: everything is exported as one JSON document,
// which the import of another system reads. The monitoring data is not part of it.
const config = require('../../config/config');
const BlockList = require('../../model/mongoDB/blockListModel');
const BlockRule = require('../../model/mongoDB/blockRuleModel');
const BlockSettings = require('../../model/mongoDB/blockSettingsModel');
const Record = require('../../model/mongoDB/recordModel');
const User = require('../../model/mongoDB/userModel');
const Zone = require('../../model/mongoDB/zoneModel');
const blockingService = require('../blockingService/blockingService');
const blockListService = require('../blockingService/blockListService');
const blockRuleService = require('../blockingService/blockRuleService');
const dnsData = require('../dnsService/dnsData');
const recordService = require('../dnsService/recordService');
const zoneService = require('../dnsService/zoneService');
const HttpError = require('../httpError');
const logService = require('../logService/logService');

const FORMAT = 'freya-ns-api-export';
const FORMAT_VERSION = 1;
// zones: the zones with their records. records: the standalone records. users: with their password hashes.
const SECTIONS = ['zones', 'records', 'blocking', 'users'];
const DEFAULT_SECTIONS = ['zones', 'records', 'blocking'];
const EXISTING = ['skip', 'overwrite'];
const MAX_ERRORS = 100;
const PASSWORD_HASH = /^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/;

const invalidDocument = (message) => new HttpError(400, `This is not an export that can be imported: ${message}`);

// The fields of `source` that are named and set.
const pick = (source, fields) =>
    Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));

// ---- export -----------------------------------------------------------------------------------------------

function parseInclude(value) {
    if (value === undefined) return DEFAULT_SECTIONS;
    const sections = String(value).split(',').map((section) => section.trim()).filter(Boolean);
    const unknown = sections.filter((section) => !SECTIONS.includes(section));
    if (!sections.length || unknown.length) throw new HttpError(400, `include must be a list of: ${SECTIONS.join(', ')}`);
    return sections;
}

const exportRecord = ({ name, type, ttl, data, active }) => ({ name, type, ttl, data, active });

async function exportZones() {
    const [zones, records] = await Promise.all([
        Zone.find().sort({ name: 1 }).lean(),
        Record.find({ zone: { $ne: null } }).sort({ name: 1, type: 1, _id: 1 }).lean(),
    ]);

    const byZone = new Map(zones.map((zone) => [String(zone._id), []]));
    for (const record of records) byZone.get(String(record.zone))?.push(exportRecord(record));

    return zones.map(({ _id, name, ttl, active, soa }) => ({ name, ttl, active, soa, records: byZone.get(String(_id)) }));
}

async function exportBlocking() {
    const [settings, lists, rules] = await Promise.all([
        blockingService.getSettings(),
        BlockList.find().sort({ name: 1, _id: 1 }).lean(),
        BlockRule.find().sort({ domain: 1 }).lean(),
    ]);
    return {
        settings,
        // The domains of a list are not exported: the importing system downloads the list itself.
        lists: lists.map(({ name, url, description, active }) => ({ name, url, description, active })),
        rules: rules.map(({ domain, action, includeSubdomains, comment, active }) => ({
            domain, action, includeSubdomains, comment, active,
        })),
    };
}

async function exportUsers() {
    const users = await User.find().select('+passwordHash').sort({ username: 1 }).lean();
    return users.map(({ username, email, displayName, role, active, passwordHash }) => ({
        username, email, displayName, role, active, passwordHash,
    }));
}

// query: { include } - a comma separated list of sections; without it everything but the users.
async function exportData(query = {}, actor) {
    const sections = parseInclude(query.include);

    const data = {};
    if (sections.includes('zones')) data.zones = await exportZones();
    if (sections.includes('records')) data.records = (await Record.find({ zone: null }).sort({ name: 1, type: 1, _id: 1 }).lean()).map(exportRecord);
    if (sections.includes('blocking')) data.blocking = await exportBlocking();
    if (sections.includes('users')) data.users = await exportUsers();

    logService.addSecurityLogInfoEntry('Export of ', sections.join(', '), ' by ', actor?.username);
    return { format: FORMAT, formatVersion: FORMAT_VERSION, version: config.version, exportedAt: new Date(), data };
}

// ---- import -----------------------------------------------------------------------------------------------

function assertDocument(document) {
    if (!dnsData.isObject(document) || document.format !== FORMAT) {
        throw invalidDocument(`its format must be "${FORMAT}"`);
    }
    if (document.formatVersion !== FORMAT_VERSION) {
        throw invalidDocument(`its formatVersion is ${document.formatVersion}, and this system reads ${FORMAT_VERSION}`);
    }
    const { data } = document;
    if (!dnsData.isObject(data)) throw invalidDocument('data must be an object');

    const lists = { zones: data.zones, records: data.records, users: data.users };
    if (data.blocking !== undefined) {
        if (!dnsData.isObject(data.blocking)) throw invalidDocument('data.blocking must be an object');
        lists['blocking.lists'] = data.blocking.lists;
        lists['blocking.rules'] = data.blocking.rules;
    }
    for (const [name, list] of Object.entries(lists)) {
        if (list !== undefined && !Array.isArray(list)) throw invalidDocument(`data.${name} must be a list`);
    }
    return data;
}

// The errors of an item that are about the item, and must not stop the import of the others.
function describeError(err) {
    if (err instanceof HttpError) return { error: err.message, details: err.details };
    if (err.name === 'ValidationError') return { error: err.message };
    if (err.code === 11000) return { error: `Already in use: ${Object.keys(err.keyPattern || {}).join(', ') || 'value'}` };
    return null;
}

function requireObject(item) {
    if (!dnsData.isObject(item)) throw new HttpError(400, 'must be an object');
}

class Import {
    constructor(existing, actor) {
        this.overwrite = existing === 'overwrite';
        this.actor = actor;
        this.report = { existing, errors: [] };
    }

    // Imports every item of a section with `importItem`, which answers "created", "updated" or
    // "skipped". An item that is refused is counted as failed, and the import goes on.
    async section(name, items, labelOf, importItem) {
        const counts = (this.report[name] ??= { created: 0, updated: 0, skipped: 0, failed: 0 });
        for (const item of items ?? []) {
            try {
                requireObject(item);
                counts[await importItem(item)] += 1;
            } catch (err) {
                const described = describeError(err);
                if (!described) throw err;
                counts.failed += 1;
                if (this.report.errors.length < MAX_ERRORS) {
                    this.report.errors.push({ section: name, item: dnsData.isObject(item) ? labelOf(item) : null, ...described });
                }
            }
        }
    }

    async zone(item) {
        const name = dnsData.parseZoneName(item.name);
        const fields = pick(item, ['soa', 'ttl', 'active']);

        let zone = await Zone.findOne({ name });
        let outcome = 'skipped';
        if (!zone) {
            zone = await zoneService.findZone((await zoneService.createZone({ name, ...fields }, this.actor)).id);
            outcome = 'created';
        } else if (this.overwrite) {
            await zoneService.updateZone(zone.id, fields, this.actor);
            outcome = 'updated';
        }

        // Also for a zone that is kept as it is: the records it does not have yet are added.
        if (item.records !== undefined && !Array.isArray(item.records)) throw new HttpError(400, 'records must be a list');
        await this.records(item.records, zone);
        // Adding the records raised the serial. A zone that was moved here as a whole is the same
        // zone as it was, so it keeps the serial it was exported with.
        if (outcome === 'created') {
            await Zone.updateOne({ _id: zone._id }, { 'soa.serial': zone.soa.serial }, { timestamps: false });
        }
        return outcome;
    }

    records(items, zone = null) {
        const where = zone ? ` in ${zone.name}` : '';
        return this.section('records', items, (item) => `${item.type} ${item.name}${where}`, (item) => this.record(item, zone));
    }

    async record(item, zone) {
        const zoneId = zone ? zone.id : null;
        const type = dnsData.parseType(item.type);
        const name = zone
            ? dnsData.parseOwnerName(item.name, zone.name)
            : dnsData.parseDomainName(item.name, { wildcard: true });
        const data = dnsData.parseRecordData(type, item.data);

        // A record is the same one when its name, type and data are the same; the rest can be overwritten.
        const found = await Record.findOne({ zone: zone ? zone._id : null, name, type, data });
        if (!found) {
            await recordService.createRecord(zoneId, { name, type, data, ...pick(item, ['ttl', 'active']) }, this.actor);
            return 'created';
        }
        if (!this.overwrite) return 'skipped';
        await recordService.updateRecord(zoneId, found.id, { ttl: item.ttl ?? null, active: item.active ?? true }, this.actor);
        return 'updated';
    }

    async blockList(item) {
        let url = item.url;
        try {
            url = new URL(String(item.url).trim()).href;
        } catch {
            // Not a URL: creating the list reports it.
        }

        const found = await BlockList.findOne({ url });
        if (!found) {
            await blockListService.createList(pick(item, ['name', 'url', 'description', 'active']), this.actor);
            return 'created';
        }
        if (!this.overwrite) return 'skipped';
        await blockListService.updateList(found.id, pick(item, ['name', 'description', 'active']), this.actor);
        return 'updated';
    }

    async blockRule(item) {
        const domain = dnsData.parseDomainName(item.domain, { field: 'domain' });
        const fields = pick(item, ['action', 'includeSubdomains', 'comment', 'active']);

        const found = await BlockRule.findOne({ domain });
        if (!found) {
            await blockRuleService.createRule({ domain, ...fields }, this.actor);
            return 'created';
        }
        if (!this.overwrite) return 'skipped';
        await blockRuleService.updateRule(found.id, fields, this.actor);
        return 'updated';
    }

    // The settings are one item: they are imported when this system has none of its own yet, or to overwrite them.
    async blockSettings(settings) {
        if (settings === undefined) return;
        if (!this.overwrite && (await BlockSettings.exists({ _id: BlockSettings.ID }))) {
            this.report.blockSettings = 'skipped';
            return;
        }
        try {
            requireObject(settings);
            await blockingService.updateSettings(pick(settings, ['enabled', 'mode']), this.actor);
            this.report.blockSettings = 'updated';
        } catch (err) {
            const described = describeError(err);
            if (!described) throw err;
            this.report.blockSettings = 'failed';
            this.report.errors.push({ section: 'blockSettings', item: null, ...described });
        }
    }

    async user(item) {
        if (typeof item.passwordHash !== 'string' || !PASSWORD_HASH.test(item.passwordHash)) {
            throw new HttpError(400, 'passwordHash must be the password hash of an export');
        }
        const username = typeof item.username === 'string' ? item.username.trim().toLowerCase() : item.username;
        const fields = pick(item, ['email', 'displayName', 'role', 'active', 'passwordHash']);

        const found = typeof username === 'string' ? await User.findOne({ username }) : null;
        if (!found) {
            await User.create({ username, ...fields });
            logService.addSecurityLogInfoEntry('User imported: ', username, ' by ', this.actor?.username);
            return 'created';
        }
        // The account that runs the import is never changed by it: it must not lock itself out.
        if (!this.overwrite || found.id === this.actor?.id) return 'skipped';

        const wasAdmin = found.role === 'admin' && found.active;
        found.set(fields);
        if (wasAdmin && !(found.role === 'admin' && found.active)) {
            const otherAdmin = await User.exists({ _id: { $ne: found._id }, role: 'admin', active: true });
            if (!otherAdmin) throw new HttpError(409, 'The last active admin cannot be demoted or deactivated');
        }
        found.tokenVersion += 1; // the tokens of the account as it was stop working
        await found.save();
        logService.addSecurityLogInfoEntry('User overwritten by import: ', username, ' by ', this.actor?.username);
        return 'updated';
    }
}

// Imports an export. What is not there yet is created; what is there already is kept, or with
// query.existing = "overwrite" updated from the export. Nothing is ever deleted.
// The import is not all-or-nothing: an item that is refused is reported, and the others are imported.
async function importData(document, query = {}, actor) {
    const data = assertDocument(document);
    const existing = query.existing ?? 'skip';
    if (!EXISTING.includes(existing)) throw new HttpError(400, `existing must be one of: ${EXISTING.join(', ')}`);

    const run = new Import(existing, actor);
    if (data.zones) await run.section('zones', data.zones, (item) => item.name, (item) => run.zone(item));
    if (data.records) await run.records(data.records);
    if (data.blocking) {
        await run.blockSettings(data.blocking.settings);
        if (data.blocking.lists) await run.section('blockLists', data.blocking.lists, (item) => item.url, (item) => run.blockList(item));
        if (data.blocking.rules) await run.section('blockRules', data.blocking.rules, (item) => item.domain, (item) => run.blockRule(item));
    }
    if (data.users) await run.section('users', data.users, (item) => item.username, (item) => run.user(item));

    logService.addSecurityLogInfoEntry('Import (existing: ', existing, ') by ', actor?.username);
    return run.report;
}

module.exports = {
    exportData,
    importData,
};
