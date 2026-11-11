const crypto = require('crypto');
const mongoose = require('mongoose');

const config = require('../../config/config');
const User = require('../../model/mongoDB/userModel');
const HttpError = require('../httpError');
const authService = require('../authService/authService');
const logService = require('../logService/logService');

const MAX_PAGE_SIZE = 100;
const SORTABLE = new Set(['username', 'email', 'displayName', 'role', 'active', 'createdAt', 'updatedAt', 'lastLoginAt']);
const SELF_EDITABLE = ['email', 'displayName'];
const ADMIN_EDITABLE = [...SELF_EDITABLE, 'username', 'role', 'active'];

const isAdmin = (actor) => actor?.role === 'admin';
const notFound = () => new HttpError(404, 'User not found');
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function assertId(id) {
    if (!mongoose.isValidObjectId(id)) throw notFound();
}

function assertPassword(password, field = 'password') {
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        throw new HttpError(400, `${field} must be a string of 8 to 128 characters`);
    }
}

function parseBoolean(value, field) {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    throw new HttpError(400, `${field} must be true or false`);
}

// Refuses a change that would leave the system without an active admin.
async function assertNotLastAdmin(user) {
    if (user.role !== 'admin' || !user.active) return;
    const otherAdmin = await User.exists({ _id: { $ne: user._id }, role: 'admin', active: true });
    if (!otherAdmin) throw new HttpError(409, 'The last active admin cannot be removed, demoted or deactivated');
}

// query: { page, limit, q, role, active, sort } - sort is a field name, prefixed with "-" for descending.
async function listUsers(query = {}) {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(query.limit, 10) || 20));

    const filter = {};
    if (query.role !== undefined) {
        if (!User.ROLES.includes(query.role)) throw new HttpError(400, `role must be one of: ${User.ROLES.join(', ')}`);
        filter.role = query.role;
    }
    if (query.active !== undefined) filter.active = parseBoolean(query.active, 'active');
    if (typeof query.q === 'string' && query.q.trim()) {
        const pattern = new RegExp(escapeRegex(query.q.trim()), 'i');
        filter.$or = [{ username: pattern }, { email: pattern }, { displayName: pattern }];
    }

    const sortParam = typeof query.sort === 'string' ? query.sort : 'username';
    const descending = sortParam.startsWith('-');
    const sortField = descending ? sortParam.slice(1) : sortParam;
    if (!SORTABLE.has(sortField)) throw new HttpError(400, `sort must be one of: ${[...SORTABLE].join(', ')}`);

    const [items, total] = await Promise.all([
        User.find(filter)
            .sort({ [sortField]: descending ? -1 : 1, _id: 1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        User.countDocuments(filter),
    ]);

    return { items: items.map(User.toPublic), page, limit, total, pages: Math.ceil(total / limit) };
}

async function getUser(id) {
    assertId(id);
    const user = await User.findById(id).lean();
    if (!user) throw notFound();
    return User.toPublic(user);
}

async function createUser(data = {}) {
    assertPassword(data.password);
    const user = await User.create({
        username: data.username,
        email: data.email,
        displayName: data.displayName,
        role: data.role,
        active: data.active,
        passwordHash: await authService.hashPassword(data.password),
    });
    logService.addSecurityLogInfoEntry('User created: ', user.username);
    return user.toJSON();
}

async function updateUser(id, data = {}, actor) {
    assertId(id);
    if ('password' in data) throw new HttpError(400, 'Use PUT /users/:id/password to change a password');

    const allowed = isAdmin(actor) ? ADMIN_EDITABLE : SELF_EDITABLE;
    const forbidden = Object.keys(data).filter((key) => !allowed.includes(key));
    if (forbidden.length) {
        const known = forbidden.every((key) => ADMIN_EDITABLE.includes(key));
        throw new HttpError(known ? 403 : 400, `These fields cannot be changed: ${forbidden.join(', ')}`);
    }
    if (!Object.keys(data).length) throw new HttpError(400, 'No fields to update');

    const user = await User.findById(id);
    if (!user) throw notFound();

    const losesAdmin = (data.role !== undefined && data.role !== 'admin') || data.active === false;
    if (losesAdmin) await assertNotLastAdmin(user);

    user.set(data);
    await user.save();
    logService.addSecurityLogInfoEntry('User updated: ', user.username, ' by ', actor?.username);
    return user.toJSON();
}

// A user changing their own password has to prove they know the current one.
async function changePassword(id, data = {}, actor) {
    assertId(id);
    assertPassword(data.newPassword, 'newPassword');

    const user = await User.findById(id).select('+passwordHash');
    if (!user) throw notFound();

    if (actor?.id === id || !isAdmin(actor)) {
        const currentOk =
            typeof data.currentPassword === 'string' &&
            (await authService.verifyPassword(data.currentPassword, user.passwordHash));
        if (!currentOk) throw new HttpError(400, 'currentPassword is incorrect');
    }

    user.passwordHash = await authService.hashPassword(data.newPassword);
    user.tokenVersion += 1; // signs the user out everywhere
    await user.save();
    logService.addSecurityLogInfoEntry('Password changed: ', user.username, ' by ', actor?.username);
}

async function deleteUser(id, actor) {
    assertId(id);
    const user = await User.findById(id);
    if (!user) throw notFound();

    await assertNotLastAdmin(user);
    await user.deleteOne();
    logService.addSecurityLogWarnEntry('User deleted: ', user.username, ' by ', actor?.username);
}

// Makes a fresh installation usable: without any user nobody could log in to create one.
async function ensureDefaultAdmin() {
    if (await User.exists({})) return;

    const password = config.defaultAdminPwd || crypto.randomBytes(12).toString('base64url');
    await createUser({
        username: config.defaultAdminUser,
        email: config.defaultAdminEmail,
        displayName: 'Administrator',
        role: 'admin',
        password,
    });

    if (!config.defaultAdminPwd) {
        console.log(`Created default admin "${config.defaultAdminUser}" with password: ${password}`);
        console.log('It is shown only this once - change it after the first login.');
    }
}

module.exports = {
    listUsers,
    getUser,
    createUser,
    updateUser,
    changePassword,
    deleteUser,
    ensureDefaultAdmin,
};
