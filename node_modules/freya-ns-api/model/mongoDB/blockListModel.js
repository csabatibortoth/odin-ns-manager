const mongoose = require('mongoose');

const STATUSES = ['pending', 'ok', 'error'];

// A list of domains to block, downloaded from a URL, e.g. a hosts file. Its domains are the block entries.
const blockListSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 100 },
        url: { type: String, required: true, unique: true, trim: true, maxlength: 2048 },
        description: { type: String, trim: true, maxlength: 500, default: '' },
        // The domains of an inactive list are kept, but must not be blocked.
        active: { type: Boolean, default: true },
        // pending: not downloaded yet; ok / error: the outcome of the last download.
        status: { type: String, enum: STATUSES, default: 'pending' },
        lastError: { type: String, default: null },
        // The last successful download. A failed one keeps the domains of the one before.
        refreshedAt: { type: Date, default: null },
        entryCount: { type: Number, default: 0 },
    },
    { timestamps: true }
);

function toPublic(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
}

blockListSchema.set('toJSON', { transform: toPublic });

const BlockList = mongoose.model('BlockList', blockListSchema);

module.exports = BlockList;
module.exports.toPublic = (plain) => toPublic(null, { ...plain });
