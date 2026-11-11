const mongoose = require('mongoose');

const ROLES = ['admin', 'user'];

const userSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            minlength: 3,
            maxlength: 32,
            match: [/^[a-z0-9._-]+$/, 'username may only contain letters, digits, ".", "_" and "-"'],
        },
        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true,
            maxlength: 254,
            match: [/^[^\s@]+@[^\s@]+$/, 'email is not valid'],
        },
        displayName: { type: String, trim: true, maxlength: 100, default: '' },
        role: { type: String, enum: ROLES, default: 'user' },
        active: { type: Boolean, default: true },
        passwordHash: { type: String, required: true, select: false },
        // Bumped whenever existing tokens must stop working (password change, logout everywhere).
        tokenVersion: { type: Number, default: 0 },
        lastLoginAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// Supports the "is this the last active admin" check and role/active list filters.
userSchema.index({ role: 1, active: 1 });

function toPublic(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    delete ret.tokenVersion;
    return ret;
}

userSchema.set('toJSON', { transform: toPublic });

const User = mongoose.model('User', userSchema);

module.exports = User;
module.exports.ROLES = ROLES;
module.exports.toPublic = (plain) => toPublic(null, { ...plain });
