// A DNS record that does not belong to a zone: a single name the server
// answers itself. It is stored next to the zones and records of freya-ns-api,
// in the same form as the records of a zone, and validated by the routes.
const mongoose = require('mongoose');

const standaloneRecordSchema = new mongoose.Schema(
    {
        // The owner of the record: fully qualified, lower case, without the trailing dot.
        name: { type: String, required: true },
        type: { type: String, required: true },
        ttl: { type: Number, default: 3600 },
        // Named as the properties of the record classes of njord-ns-server, e.g. { target } or { exchange, priority }.
        data: { type: mongoose.Schema.Types.Mixed, required: true },
        // An inactive record is kept, but not served.
        active: { type: Boolean, default: true },
    },
    { timestamps: true, minimize: false }
);

// Refuses identical records, and serves the listing.
standaloneRecordSchema.index({ name: 1, type: 1, data: 1 }, { unique: true });

function toPublic(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
}

standaloneRecordSchema.set('toJSON', { transform: toPublic });

const StandaloneRecord = mongoose.model('StandaloneRecord', standaloneRecordSchema);

module.exports = StandaloneRecord;
module.exports.toPublic = (plain) => toPublic(null, { ...plain });
