// The blocklists and the allowed names. Mounted at /api/blocklists, next to the
// API of freya-ns-api, and answering in the same way. Every signed-in user
// may read them; only admins change them, as the server downloads from the
// addresses that are given here.
const express = require('express');

const blockService = require('../serverService/blockService');

function createService() {
    const mongoose = require('mongoose');
    const validators = require('njord-ns-server/lib/validators');
    const HttpError = require('freya-ns-api/services/httpError');
    const dnsData = require('freya-ns-api/services/dnsService/dnsData');
    const { logService } = require('./apiService');
    const { Blocklist, AllowedName, toPublic } = require('../../model/mongoDB/blocklistModel');

    const notFound = (what) => new HttpError(404, `${what} not found`);

    function parseUrl(value) {
        let url;
        try {
            url = new URL(typeof value === 'string' ? value.trim() : '');
        } catch {
            throw dnsData.invalid({ url: 'url must be the address of a list, e.g. https://example.com/hosts' });
        }
        if (!['http:', 'https:'].includes(url.protocol)) throw dnsData.invalid({ url: 'url must start with http:// or https://' });
        if (url.username || url.password) throw dnsData.invalid({ url: 'url must not hold a user name or a password' });
        if (url.href.length > 2000) throw dnsData.invalid({ url: 'url is too long' });
        return url.href;
    }

    function parseText(value, field, max, required) {
        const text = typeof value === 'string' ? value.trim() : '';
        if ((required && !text) || text.length > max) throw dnsData.invalid({ [field]: `${field} must be a text of ${required ? 1 : 0} to ${max} characters` });
        return text;
    }

    function parseFlag(value, field) {
        if (typeof value !== 'boolean') throw dnsData.invalid({ [field]: `${field} must be true or false` });
        return value;
    }

    async function findList(id) {
        if (!mongoose.isValidObjectId(id)) throw notFound('Blocklist');
        const list = await Blocklist.findById(id);
        if (!list) throw notFound('Blocklist');
        return list;
    }

    async function save(document, message) {
        try {
            await document.save();
        } catch (err) {
            if (err.code === 11000) throw new HttpError(409, message);
            throw err;
        }
    }

    async function listLists() {
        return (await Blocklist.find().sort({ name: 1, _id: 1 }).lean()).map(toPublic);
    }

    // data: { name, url, subdomains?, active? } - the list is downloaded at once
    async function createList(data, actor) {
        dnsData.assertOnly(data, ['name', 'url', 'subdomains', 'active']);
        const list = new Blocklist({ name: parseText(data.name, 'name', 100, true), url: parseUrl(data.url) });
        if (data.subdomains !== undefined) list.subdomains = parseFlag(data.subdomains, 'subdomains');
        if (data.active !== undefined) list.active = parseFlag(data.active, 'active');

        await save(list, 'A blocklist with this address already exists');
        logService.addInfoLogBasicInfoEntry('Blocklist created: ', list.name, ' (', list.url, ') by ', actor?.username);
        if (list.active) await blockService.download(list);
        await blockService.sync();
        return list.toJSON();
    }

    // data: { name?, url?, subdomains?, active? } - a new address is downloaded at once
    async function updateList(id, data, actor) {
        dnsData.assertOnly(data, ['name', 'url', 'subdomains', 'active']);
        if (!Object.keys(data).length) throw new HttpError(400, 'No fields to update');

        const list = await findList(id);
        if (data.name !== undefined) list.name = parseText(data.name, 'name', 100, true);
        if (data.url !== undefined) list.url = parseUrl(data.url);
        if (data.subdomains !== undefined) list.subdomains = parseFlag(data.subdomains, 'subdomains');
        if (data.active !== undefined) list.active = parseFlag(data.active, 'active');

        const fetchAgain = list.active && (list.isModified('url') || !list.fetchedAt);
        if (list.isModified('url')) {
            // The names of the old address are not the ones of the new
            list.content = undefined;
            list.entries = 0;
            list.fetchedAt = null;
        }
        await save(list, 'A blocklist with this address already exists');
        logService.addInfoLogBasicInfoEntry('Blocklist updated: ', list.name, ' by ', actor?.username);
        if (fetchAgain) await blockService.download(list);
        await blockService.sync();
        return list.toJSON();
    }

    async function refreshList(id, actor) {
        const list = await findList(id);
        logService.addInfoLogBasicInfoEntry('Blocklist download asked: ', list.name, ' by ', actor?.username);
        await blockService.download(list);
        await blockService.sync();
        return list.toJSON();
    }

    async function deleteList(id, actor) {
        const list = await findList(id);
        await list.deleteOne();
        logService.addInfoLogBasicInfoEntry('Blocklist deleted: ', list.name, ' by ', actor?.username);
        await blockService.sync();
    }

    async function listAllowed() {
        return (await AllowedName.find().sort({ name: 1 }).lean()).map(toPublic);
    }

    // data: { name, note? }
    async function createAllowed(data, actor) {
        dnsData.assertOnly(data, ['name', 'note']);
        const name = typeof data.name === 'string' ? data.name.trim().toLowerCase().replace(/\.$/, '') : '';
        if (!name || name.length > 253 || !validators.nsDomain(name)) throw dnsData.invalid({ name: 'name must be a domain name, e.g. example.com' });

        const entry = new AllowedName({ name, note: parseText(data.note, 'note', 200, false) });
        await save(entry, `${name} is allowed already`);
        logService.addInfoLogBasicInfoEntry('Allowed name added: ', name, ' by ', actor?.username);
        await blockService.sync();
        return entry.toJSON();
    }

    async function deleteAllowed(id, actor) {
        if (!mongoose.isValidObjectId(id)) throw notFound('Allowed name');
        const entry = await AllowedName.findByIdAndDelete(id);
        if (!entry) throw notFound('Allowed name');
        logService.addInfoLogBasicInfoEntry('Allowed name removed: ', entry.name, ' by ', actor?.username);
        await blockService.sync();
    }

    return { findList, listLists, createList, updateList, refreshList, deleteList, listAllowed, createAllowed, deleteAllowed };
}

function createRouter() {
    const { authenticate, requireRole } = require('freya-ns-api/services/authService/authService');
    const { finish, prepare } = require('./serviceRoutes');
    const service = createService();

    const router = prepare(express.Router());
    const adminOnly = requireRole('admin');

    router.use(authenticate);

    router.get('/', async (req, res) => {
        res.json({ items: await service.listLists(), state: blockService.state() });
    });

    router.post('/', adminOnly, async (req, res) => {
        const list = await service.createList(req.body, req.user);
        res.status(201).location(`${req.baseUrl}/${list.id}`).json(list);
    });

    // Before /:listId, which would take "allowed" for an id
    router.get('/allowed', async (req, res) => {
        res.json({ items: await service.listAllowed() });
    });

    router.post('/allowed', adminOnly, async (req, res) => {
        res.status(201).json(await service.createAllowed(req.body, req.user));
    });

    router.delete('/allowed/:allowedId', adminOnly, async (req, res) => {
        await service.deleteAllowed(req.params.allowedId, req.user);
        res.status(204).end();
    });

    router.get('/:listId', async (req, res) => {
        res.json((await service.findList(req.params.listId)).toJSON());
    });

    router.patch('/:listId', adminOnly, async (req, res) => {
        res.json(await service.updateList(req.params.listId, req.body, req.user));
    });

    // Downloads the list now
    router.post('/:listId/update', adminOnly, async (req, res) => {
        res.json(await service.refreshList(req.params.listId, req.user));
    });

    router.delete('/:listId', adminOnly, async (req, res) => {
        await service.deleteList(req.params.listId, req.user);
        res.status(204).end();
    });

    return finish(router);
}

module.exports = { createRouter };
