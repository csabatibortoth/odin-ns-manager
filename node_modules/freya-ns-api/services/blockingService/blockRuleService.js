const mongoose = require('mongoose');

const BlockRule = require('../../model/mongoDB/blockRuleModel');
const dnsData = require('../dnsService/dnsData');
const HttpError = require('../httpError');
const { escapeRegex, parseBoolean, parsePaging, parseSort, findPage } = require('../listQuery');
const logService = require('../logService/logService');

const SORTABLE = new Set(['domain', 'action', 'active', 'createdAt', 'updatedAt']);
const FIELDS = ['domain', 'action', 'includeSubdomains', 'comment', 'active'];

const notFound = () => new HttpError(404, 'Block rule not found');
const describe = (rule) => `${rule.action} ${rule.includeSubdomains ? '*.' : ''}${rule.domain}`;

async function findRule(id) {
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const rule = await BlockRule.findById(id);
    if (!rule) throw notFound();
    return rule;
}

function parseAction(value) {
    if (!BlockRule.ACTIONS.includes(value)) {
        throw dnsData.invalid({ action: `action must be one of: ${BlockRule.ACTIONS.join(', ')}` });
    }
    return value;
}

function parseFlag(value, field) {
    if (typeof value !== 'boolean') throw dnsData.invalid({ [field]: `${field} must be true or false` });
    return value;
}

function parseComment(value) {
    if (typeof value !== 'string' || value.trim().length > 500) {
        throw dnsData.invalid({ comment: 'comment must be a text of at most 500 characters' });
    }
    return value.trim();
}

// Applies the fields of `data` that are set to the rule.
function assign(rule, data) {
    if (data.domain !== undefined) rule.domain = dnsData.parseDomainName(data.domain, { field: 'domain' });
    if (data.action !== undefined) rule.action = parseAction(data.action);
    if (data.includeSubdomains !== undefined) rule.includeSubdomains = parseFlag(data.includeSubdomains, 'includeSubdomains');
    if (data.comment !== undefined) rule.comment = parseComment(data.comment);
    if (data.active !== undefined) rule.active = dnsData.parseActive(data.active);
}

async function save(rule) {
    try {
        await rule.save();
    } catch (err) {
        if (err.code === 11000) throw new HttpError(409, `There is already a rule for ${rule.domain}`);
        throw err;
    }
}

// query: { page, limit, q, action, active, sort } - sort is a field name, prefixed with "-" for descending.
async function listRules(query = {}) {
    const filter = {};
    if (query.action !== undefined) filter.action = parseAction(query.action);
    if (query.active !== undefined) filter.active = parseBoolean(query.active, 'active');
    if (typeof query.q === 'string' && query.q.trim()) {
        const pattern = new RegExp(escapeRegex(query.q.trim()), 'i');
        filter.$or = [{ domain: pattern }, { comment: pattern }];
    }

    return findPage(BlockRule, filter, parsePaging(query), parseSort(query, SORTABLE, 'domain'), BlockRule.toPublic);
}

async function getRule(id) {
    return (await findRule(id)).toJSON();
}

// data: { domain, action, includeSubdomains?, comment?, active? }
async function createRule(data, actor) {
    dnsData.assertOnly(data, FIELDS);

    const rule = new BlockRule();
    // Both are required: an undefined value is reported by its parser.
    assign(rule, { ...data, domain: data.domain ?? null, action: data.action ?? null });

    await save(rule);
    logService.addInfoLogBasicInfoEntry('Block rule created: ', describe(rule), ' by ', actor?.username);
    return rule.toJSON();
}

// data: { domain?, action?, includeSubdomains?, comment?, active? }
async function updateRule(id, data, actor) {
    dnsData.assertOnly(data, FIELDS);
    if (!Object.keys(data).length) throw new HttpError(400, 'No fields to update');

    const rule = await findRule(id);
    assign(rule, data);

    await save(rule);
    logService.addInfoLogBasicInfoEntry('Block rule updated: ', describe(rule), ' by ', actor?.username);
    return rule.toJSON();
}

async function deleteRule(id, actor) {
    const rule = await findRule(id);
    await rule.deleteOne();
    logService.addInfoLogBasicInfoEntry('Block rule deleted: ', describe(rule), ' by ', actor?.username);
}

module.exports = {
    listRules,
    getRule,
    createRule,
    updateRule,
    deleteRule,
};
