const mongoose = require('mongoose');
const cron = require('node-cron');

const config = require('../../config/config');
const BlockEntry = require('../../model/mongoDB/blockEntryModel');
const BlockList = require('../../model/mongoDB/blockListModel');
const dnsData = require('../dnsService/dnsData');
const HttpError = require('../httpError');
const { escapeRegex, parseBoolean, parsePaging, parseSort, findPage } = require('../listQuery');
const logService = require('../logService/logService');
const { parseBlockList } = require('./listParser');

const SORTABLE = new Set(['name', 'url', 'active', 'status', 'entryCount', 'refreshedAt', 'createdAt', 'updatedAt']);
const STATUSES = BlockList.schema.path('status').enumValues;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const BATCH_SIZE = 5000;

const notFound = () => new HttpError(404, 'Block list not found');

// The downloads that are running, by the id of the list. Kept in memory: a restart ends them anyway.
const refreshing = new Map();

// What the API answers with: the stored list, and whether it is being downloaded right now.
const present = (list) => ({ ...list, refreshing: refreshing.has(list.id) });

async function findList(id) {
    if (!mongoose.isValidObjectId(id)) throw notFound();
    const list = await BlockList.findById(id);
    if (!list) throw notFound();
    return list;
}

function parseText(value, field, { max, required = false }) {
    const text = typeof value === 'string' ? value.trim() : value;
    if (typeof text !== 'string' || text.length > max || (required && !text)) {
        throw dnsData.invalid({ [field]: `${field} must be a text of ${required ? '1' : '0'} to ${max} characters` });
    }
    return text;
}

function parseUrl(value) {
    let url;
    try {
        url = new URL(typeof value === 'string' ? value.trim() : '');
    } catch {
        url = null;
    }
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.href.length > 2048) {
        throw dnsData.invalid({ url: 'url must be an http or https address, e.g. https://example.com/hosts' });
    }
    return url.href;
}

async function download(url) {
    let response;
    try {
        response = await fetch(url, {
            headers: { accept: 'text/plain, */*' },
            signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`The server answered with status ${response.status}`);

        const maxSize = config.blockListMaxSizeMb * 1024 * 1024;
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > maxSize) throw new Error(`The list is larger than ${config.blockListMaxSizeMb} MB`);
            chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString('utf8');
    } catch (err) {
        if (err.name === 'TimeoutError') throw new Error(`The download took longer than ${DOWNLOAD_TIMEOUT_MS / 1000} seconds`);
        // fetch reports a network failure as "fetch failed", with the reason in the cause.
        throw new Error(err.cause?.message || err.message);
    }
}

function* batches(items) {
    for (let start = 0; start < items.length; start += BATCH_SIZE) yield items.slice(start, start + BATCH_SIZE);
}

// Makes the stored entries of the list equal to `domains`. Only the difference is written, so a
// domain that stays on the list is blocked without a gap, and a list that did not change costs nothing.
async function syncEntries(listId, domains) {
    const stored = new Set();
    for await (const entry of BlockEntry.find({ list: listId }).select('domain -_id').lean().cursor()) {
        stored.add(entry.domain);
    }

    const added = [...domains].filter((domain) => !stored.has(domain));
    const removed = [...stored].filter((domain) => !domains.has(domain));

    for (const batch of batches(added)) {
        await BlockEntry.collection.insertMany(batch.map((domain) => ({ list: listId, domain })), { ordered: false });
    }
    for (const batch of batches(removed)) {
        await BlockEntry.deleteMany({ list: listId, domain: { $in: batch } });
    }
    return { added: added.length, removed: removed.length };
}

// Downloads the list and stores its domains. A failure is recorded on the list, and keeps the domains it had.
async function runRefresh(id) {
    const list = await BlockList.findById(id).lean();
    if (!list) return null;

    let outcome;
    try {
        const domains = parseBlockList(await download(list.url));
        if (!domains.size) throw new Error('No domains were found in the downloaded list');

        const { added, removed } = await syncEntries(list._id, domains);
        outcome = { status: 'ok', lastError: null, refreshedAt: new Date(), entryCount: domains.size };
        logService.addInfoLogBasicInfoEntry(
            'Block list refreshed: ', list.name, ' - ', domains.size, ' domain(s), ', added, ' added, ', removed, ' removed'
        );
    } catch (err) {
        outcome = { status: 'error', lastError: err.message };
        logService.addErrorLogErrorEntry('Block list refresh failed: ', list.name, ' (', list.url, ') - ', err.message);
    }

    const updated = await BlockList.findOneAndUpdate({ _id: list._id }, outcome, { returnDocument: 'after' }).lean();
    // Deleted while it was being downloaded: its entries must not stay behind.
    if (!updated) await BlockEntry.deleteMany({ list: list._id });
    return updated && BlockList.toPublic(updated);
}

// Starts a download of the list, after the one that is running for it, if any. Resolves to the stored list.
function queueRefresh(id) {
    const key = String(id);
    const run = (refreshing.get(key) ?? Promise.resolve())
        .catch(() => {})
        .then(() => runRefresh(key))
        .finally(() => {
            if (refreshing.get(key) === run) refreshing.delete(key);
        });
    refreshing.set(key, run);
    return run;
}

// For a download nobody waits for. runRefresh records what goes wrong with the list; this catches the rest.
function refreshInBackground(id) {
    queueRefresh(id).catch((err) => logService.addErrorLogErrorEntry('Block list refresh failed: ', err.stack || err));
}

// Downloads the list now and answers when it is done. A download that is already running is not started twice.
async function refreshList(id) {
    const list = await findList(id);
    const updated = await (refreshing.get(list.id) ?? queueRefresh(list.id));
    if (!updated) throw notFound();
    return present(updated);
}

// Downloads every active list, one after the other. Resolves to the number of lists.
async function refreshAll() {
    const lists = await BlockList.find({ active: true }).select('_id').lean();
    for (const list of lists) await (refreshing.get(String(list._id)) ?? queueRefresh(list._id));
    return lists.length;
}

// Starts the download of every active list, and answers at once with the number of lists.
async function refreshAllInBackground() {
    const started = await BlockList.countDocuments({ active: true });
    refreshAll().catch((err) => logService.addErrorLogErrorEntry('Block list refresh failed: ', err.stack || err));
    return { started };
}

// query: { page, limit, q, active, status, sort } - sort is a field name, prefixed with "-" for descending.
async function listLists(query = {}) {
    const filter = {};
    if (query.active !== undefined) filter.active = parseBoolean(query.active, 'active');
    if (query.status !== undefined) {
        if (!STATUSES.includes(query.status)) throw new HttpError(400, `status must be one of: ${STATUSES.join(', ')}`);
        filter.status = query.status;
    }
    if (typeof query.q === 'string' && query.q.trim()) {
        const pattern = new RegExp(escapeRegex(query.q.trim()), 'i');
        filter.$or = [{ name: pattern }, { url: pattern }, { description: pattern }];
    }

    const toPublic = (list) => present(BlockList.toPublic(list));
    return findPage(BlockList, filter, parsePaging(query), parseSort(query, SORTABLE, 'name'), toPublic);
}

async function getList(id) {
    return present((await findList(id)).toJSON());
}

// The domains of a list. query: { page, limit, q } - q is a part of the domain.
async function listEntries(id, query = {}) {
    const list = await findList(id);

    const filter = { list: list._id };
    if (typeof query.q === 'string' && query.q.trim()) {
        filter.domain = new RegExp(escapeRegex(query.q.trim().toLowerCase()));
    }
    return findPage(BlockEntry, filter, parsePaging(query), { domain: 1 }, (entry) => entry.domain);
}

// data: { name, url, description?, active? } - the list is downloaded in the background right away.
async function createList(data, actor) {
    dnsData.assertOnly(data, ['name', 'url', 'description', 'active']);

    const list = new BlockList({
        name: parseText(data.name, 'name', { max: 100, required: true }),
        url: parseUrl(data.url),
    });
    if (data.description !== undefined) list.description = parseText(data.description, 'description', { max: 500 });
    if (data.active !== undefined) list.active = dnsData.parseActive(data.active);

    await list.save();
    logService.addInfoLogBasicInfoEntry('Block list created: ', list.name, ' (', list.url, ') by ', actor?.username);
    refreshInBackground(list.id);
    return present(list.toJSON());
}

// data: { name?, url?, description?, active? } - a new url is downloaded in the background right away.
async function updateList(id, data, actor) {
    dnsData.assertOnly(data, ['name', 'url', 'description', 'active']);
    if (!Object.keys(data).length) throw new HttpError(400, 'No fields to update');

    const list = await findList(id);
    if (data.name !== undefined) list.name = parseText(data.name, 'name', { max: 100, required: true });
    if (data.url !== undefined) list.url = parseUrl(data.url);
    if (data.description !== undefined) list.description = parseText(data.description, 'description', { max: 500 });
    if (data.active !== undefined) list.active = dnsData.parseActive(data.active);

    const urlChanged = list.isModified('url');
    if (urlChanged) list.status = 'pending';
    await list.save();
    logService.addInfoLogBasicInfoEntry('Block list updated: ', list.name, ' by ', actor?.username);
    if (urlChanged) refreshInBackground(list.id);
    return present(list.toJSON());
}

// Deletes the list together with all of its domains.
async function deleteList(id, actor) {
    const list = await findList(id);
    await list.deleteOne();
    const { deletedCount } = await BlockEntry.deleteMany({ list: list._id });
    logService.addInfoLogBasicInfoEntry(
        'Block list deleted: ', list.name, ' with ', deletedCount, ' domain(s) by ', actor?.username
    );
}

// Downloads the lists again on the schedule of the configuration. Returns the task, or null when there is none.
function startSchedule() {
    const expression = config.blockListRefreshCron.trim();
    if (!expression) return null;
    if (!cron.validate(expression)) throw new Error(`FREYA_BLOCKLIST_REFRESH_CRON is not a cron expression: ${expression}`);

    return cron.schedule(expression, () => {
        refreshAll().catch((err) => logService.addErrorLogErrorEntry('Block list refresh failed: ', err.stack || err));
    });
}

module.exports = {
    listLists,
    getList,
    listEntries,
    createList,
    updateList,
    deleteList,
    refreshList,
    refreshAll,
    refreshAllInBackground,
    startSchedule,
};
