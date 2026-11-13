const mongoose = require('mongoose');

// A client of the name server: an address that sent at least one query. Created and counted by
// the monitoring service as the queries are recorded; only its name is set by hand.
const clientSchema = new mongoose.Schema(
    {
        address: { type: String, required: true, unique: true },
        // A name for the people who read the list, e.g. "Living room TV".
        name: { type: String, trim: true, maxlength: 100, default: '' },
        firstSeenAt: { type: Date, required: true },
        lastSeenAt: { type: Date, required: true },
        // Counted since the client was first seen; they do not shrink when old queries are deleted.
        queries: { type: Number, default: 0 },
        blocked: { type: Number, default: 0 },
    },
    { versionKey: false }
);

clientSchema.index({ lastSeenAt: -1 });

function toPublic(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
}

clientSchema.set('toJSON', { transform: toPublic });

const Client = mongoose.model('Client', clientSchema);

module.exports = Client;
module.exports.toPublic = (plain) => toPublic(null, { ...plain });
