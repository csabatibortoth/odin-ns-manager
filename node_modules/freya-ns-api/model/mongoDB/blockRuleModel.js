const mongoose = require('mongoose');

const ACTIONS = ['block', 'allow'];

// A rule for a single domain, set by hand. It wins over the block lists: "block" adds a domain to
// them, "allow" takes one out. Values are validated by the block rule service.
const blockRuleSchema = new mongoose.Schema(
    {
        // Fully qualified, lower case, without the trailing dot.
        domain: { type: String, required: true, unique: true },
        action: { type: String, enum: ACTIONS, required: true },
        // Whether the rule holds for every name below the domain as well.
        includeSubdomains: { type: Boolean, default: false },
        comment: { type: String, trim: true, maxlength: 500, default: '' },
        // An inactive rule is kept, but must not be applied.
        active: { type: Boolean, default: true },
    },
    { timestamps: true }
);

function toPublic(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
}

blockRuleSchema.set('toJSON', { transform: toPublic });

const BlockRule = mongoose.model('BlockRule', blockRuleSchema);

module.exports = BlockRule;
module.exports.ACTIONS = ACTIONS;
module.exports.toPublic = (plain) => toPublic(null, { ...plain });
