const mongoose = require('mongoose');

// One domain of a block list. A large list has hundreds of thousands of these, so they are kept as small as possible.
const blockEntrySchema = new mongoose.Schema(
    {
        list: { type: mongoose.Schema.Types.ObjectId, ref: 'BlockList', required: true },
        // Fully qualified, lower case, without the trailing dot.
        domain: { type: String, required: true },
    },
    { versionKey: false }
);

// Keeps a domain once per list, and serves the listing of a list.
blockEntrySchema.index({ list: 1, domain: 1 }, { unique: true });
// The lookup a name server does to decide whether a name is blocked.
blockEntrySchema.index({ domain: 1 });

module.exports = mongoose.model('BlockEntry', blockEntrySchema);
