// Lost passwords: a user asks for a link, it is mailed to the address of their
// account, and the link lets them choose a new password once, within an hour.
// The tokens are kept in memory, and only as hashes: a restart of the server
// makes the links that were sent invalid.
const crypto = require('crypto');
const config = require('../../config/config');
const mailService = require('./mailService');

const LIFETIME = 60 * 60 * 1000;
const MAX_PENDING = 1000;
const COOLDOWN = 60 * 1000; // between two mails to the same account

const pending = new Map(); // sha256 of the token -> { userId, expires }
const lastAsked = new Map(); // user id -> time

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const logs = () => require('../apiService/apiService').logService;
const error = (status, message, details) => Object.assign(new Error(message), { status, details });

function sweep() {
    const now = Date.now();
    for (const [key, entry] of pending) if (entry.expires < now) pending.delete(key);
    for (const [id, at] of lastAsked) if (at < now - COOLDOWN) lastAsked.delete(id);
}

function isAvailable() {
    return mailService.isConfigured() && Boolean(config.publicUrl);
}

// Mails the link, when the address belongs to an active account. Nothing tells
// whether it did: the answer is the same for every address.
async function request(email) {
    if (!isAvailable()) throw error(404, 'Lost password mails are not set up');
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email.trim())) throw error(400, 'Validation failed', { email: 'email is not valid' });

    sweep();
    const User = require('freya-ns-api/model/mongoDB/userModel');
    const user = await User.findOne({ email: email.trim().toLowerCase(), active: true });
    if (!user || lastAsked.has(String(user._id)) || pending.size >= MAX_PENDING) return;

    lastAsked.set(String(user._id), Date.now());
    const token = crypto.randomBytes(32).toString('base64url');
    pending.set(hash(token), { userId: String(user._id), expires: Date.now() + LIFETIME });

    const link = `${config.publicUrl.replace(/\/$/, '')}/#/reset/${token}`;
    try {
        await mailService.send({
            to: user.email,
            subject: 'Choose a new password',
            text: `Hello ${user.displayName || user.username},\n\nSomebody asked for a new password of your account (${user.username}). Open this link within an hour to choose one:\n\n${link}\n\nIf it was not you, ignore this mail: nothing is changed.`,
        });
        logs().addSecurityLogInfoEntry('Lost password mail sent for ', user.username);
    } catch (err) {
        logs().addErrorLogErrorEntry('Lost password mail could not be sent: ', err.message);
    }
}

// Is the link still good?
function check(token) {
    sweep();
    return typeof token === 'string' && pending.has(hash(token));
}

async function reset(token, password) {
    const key = typeof token === 'string' ? hash(token) : '';
    const entry = pending.get(key);
    if (!entry || entry.expires < Date.now()) throw error(400, 'The link is not valid any more. Ask for a new one.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        throw error(400, 'Validation failed', { password: 'password must be 8 to 128 characters' });
    }

    const User = require('freya-ns-api/model/mongoDB/userModel');
    const { hashPassword } = require('freya-ns-api/services/authService/authService');
    const user = await User.findOne({ _id: entry.userId, active: true }).select('+passwordHash');
    pending.delete(key);
    if (!user) throw error(400, 'The link is not valid any more. Ask for a new one.');

    user.passwordHash = await hashPassword(password);
    user.tokenVersion += 1; // signs the user out everywhere
    await user.save();
    for (const [other, value] of pending) if (value.userId === entry.userId) pending.delete(other);
    logs().addSecurityLogInfoEntry('Password reset by mail: ', user.username);
}

module.exports = { isAvailable, request, check, reset };
