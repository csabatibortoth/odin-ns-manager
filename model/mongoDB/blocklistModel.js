// The blocklists: lists of names the DNS server does not look up, downloaded
// from an address; and the names that are allowed in spite of them.
const mongoose = require('mongoose');

const blocklistSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true, maxlength: 100 },
        // Where the list is downloaded from: a hosts file, or a list of names
        url: { type: String, required: true, unique: true, maxlength: 2000 },
        // Also block the names below the names of the list
        subdomains: { type: Boolean, default: false },
        // An inactive list is kept, but not used and not downloaded.
        active: { type: Boolean, default: true },
        // The number of names of the last download
        entries: { type: Number, default: 0 },
        // The last successful download, and the last attempt
        fetchedAt: { type: Date, default: null },
        checkedAt: { type: Date, default: null },
        // Why the last attempt failed; empty when it did not
        lastError: { type: String, default: '' },
        // The names of the last download, one on a line, compressed with gzip
        content: { type: Buffer, select: false },
    },
    { timestamps: true }
);

const allowedNameSchema = new mongoose.Schema(
    {
        // Fully qualified, lower case, without the trailing dot. The names below it are allowed as well.
        name: { type: String, required: true, unique: true },
        note: { type: String, trim: true, maxlength: 200, default: '' },
    },
    { timestamps: true }
);

function toPublic(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.content;
    return ret;
}

blocklistSchema.set('toJSON', { transform: toPublic });
allowedNameSchema.set('toJSON', { transform: toPublic });

const Blocklist = mongoose.model('Blocklist', blocklistSchema);
const AllowedName = mongoose.model('AllowedName', allowedNameSchema);

module.exports = { Blocklist, AllowedName, toPublic: (plain) => toPublic(null, { ...plain }) };
