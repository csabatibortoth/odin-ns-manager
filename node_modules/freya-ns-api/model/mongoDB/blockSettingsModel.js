const mongoose = require('mongoose');

// NULL_IP: answer a blocked name with 0.0.0.0 and ::. NXDOMAIN: answer that the name does not exist.
const MODES = ['NULL_IP', 'NXDOMAIN'];
const ID = 'blocking';

// The settings of the blocking as a whole. There is a single document, with a fixed id.
const blockSettingsSchema = new mongoose.Schema(
    {
        _id: { type: String, default: ID },
        // The switch of all blocking: when false, nothing is blocked, whatever the lists and rules say.
        enabled: { type: Boolean, default: true },
        mode: { type: String, enum: MODES, default: 'NULL_IP' },
    },
    { timestamps: true }
);

function toPublic(doc, ret) {
    delete ret._id;
    delete ret.__v;
    delete ret.createdAt;
    delete ret.updatedAt;
    return ret;
}

blockSettingsSchema.set('toJSON', { transform: toPublic });

const BlockSettings = mongoose.model('BlockSettings', blockSettingsSchema);

module.exports = BlockSettings;
module.exports.MODES = MODES;
module.exports.ID = ID;
