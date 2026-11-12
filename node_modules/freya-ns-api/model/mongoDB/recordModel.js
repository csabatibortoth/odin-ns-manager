const mongoose = require('mongoose');

// A DNS record of a zone. Values are validated by the record service, against the rules of njord-ns-server.
const recordSchema = new mongoose.Schema(
    {
        zone: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone', required: true },
        // The owner of the record: fully qualified, lower case, without the trailing dot.
        name: { type: String, required: true },
        type: { type: String, required: true },
        // null: the TTL of the zone applies.
        ttl: { type: Number, default: null },
        // Named as the properties of the record classes of njord-ns-server, e.g. { target } or { exchange, priority }.
        data: { type: mongoose.Schema.Types.Mixed, required: true },
        // An inactive record is kept, but must not be served.
        active: { type: Boolean, default: true },
    },
    { timestamps: true, minimize: false }
);

// Refuses identical records, and serves the listing of a zone.
recordSchema.index({ zone: 1, name: 1, type: 1, data: 1 }, { unique: true });
// The lookup a name server does to answer a query.
recordSchema.index({ name: 1, type: 1 });

function toPublic(doc, ret) {
    ret.id = String(ret._id);
    ret.zone = String(ret.zone);
    delete ret._id;
    delete ret.__v;
    return ret;
}

recordSchema.set('toJSON', { transform: toPublic });

const Record = mongoose.model('Record', recordSchema);

module.exports = Record;
module.exports.toPublic = (plain) => toPublic(null, { ...plain });
