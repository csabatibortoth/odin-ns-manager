const crypto = require('crypto');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');

const config = require('../../config/config');
const User = require('../../model/mongoDB/userModel');
const HttpError = require('../httpError');
const logService = require('../logService/logService');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const JWT_ALGORITHM = 'HS256';

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(password, salt, KEY_LENGTH);
    return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
    const [scheme, salt, key] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !key) return false;
    const expected = Buffer.from(key, 'base64');
    const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
}

// Verified against when the user does not exist, so that a login attempt takes
// the same time whether or not the username is known.
let dummyHash;
const getDummyHash = () => (dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex')));

function signToken(user) {
    return jwt.sign({ role: user.role, tv: user.tokenVersion }, config.secret, {
        subject: String(user._id),
        expiresIn: config.tokenExpiresIn,
        algorithm: JWT_ALGORITHM,
    });
}

// creds: { username, password } - username may also be the e-mail address.
async function authentication(creds) {
    const { username, password } = creds ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
        throw new HttpError(400, 'username and password are required');
    }

    const login = username.trim().toLowerCase();
    const user = await User.findOne({ $or: [{ username: login }, { email: login }] }).select('+passwordHash');
    const passwordOk = await verifyPassword(password, user ? user.passwordHash : await getDummyHash());

    if (!user || !passwordOk || !user.active) {
        logService.addSecurityLogWarnEntry('Failed login for ', login);
        throw new HttpError(401, 'Invalid username or password');
    }

    user.lastLoginAt = new Date();
    await user.save();
    logService.addSecurityLogInfoEntry('Successful login for ', user.username);

    return { token: signToken(user), tokenType: 'Bearer', expiresIn: config.tokenExpiresIn, user: user.toJSON() };
}

// Express middleware: resolves the bearer token to req.user = { id, username, role }.
async function authenticate(req, res, next) {
    if (!config.authEnabled) {
        req.user = { id: null, username: 'anonymous', role: 'admin' };
        return next();
    }

    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new HttpError(401, 'Authentication token is missing');

    let payload;
    try {
        payload = jwt.verify(token, config.secret, { algorithms: [JWT_ALGORITHM] });
    } catch {
        throw new HttpError(401, 'Authentication token is invalid or expired');
    }

    // Looked up on every request so that deleted, deactivated or re-keyed users lose access immediately.
    const user = await User.findById(payload.sub).select('username role active tokenVersion').lean();
    if (!user || !user.active || user.tokenVersion !== payload.tv) {
        throw new HttpError(401, 'Authentication token is no longer valid');
    }

    req.user = { id: String(user._id), username: user.username, role: user.role };
    next();
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user?.role)) throw new HttpError(403, 'You are not allowed to do this');
        next();
    };
}

// Lets a user through for their own record, and admins for any record.
function requireSelfOrAdmin(req, res, next) {
    if (req.user?.role !== 'admin' && req.user?.id !== req.params.id) {
        throw new HttpError(403, 'You are not allowed to do this');
    }
    next();
}

// Invalidates every token issued so far for the user.
async function revokeTokens(userId) {
    await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
}

module.exports = {
    hashPassword,
    verifyPassword,
    authentication,
    authenticate,
    requireRole,
    requireSelfOrAdmin,
    revokeTokens,
};
