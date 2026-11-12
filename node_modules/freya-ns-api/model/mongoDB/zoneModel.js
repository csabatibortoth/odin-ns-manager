const mongoose = require('mongoose');

// A DNS zone. Values are validated by the zone service, against the rules of njord-ns-server.
const zoneSchema = new mongoose.Schema(
    {
        // Fully qualified, lower case, without the trailing dot.
        name: { type: String, required: true, unique: true },
        // TTL of the records of the zone that do not set their own.
        ttl: { type: Number, default: 3600 },
        // An inactive zone is kept, but must not be served.
        active: { type: Boolean, default: true },
        // Named as the properties of the SOARecord of njord-ns-server: new SOARecord(soa.host, soa)
        soa: {
            host: { type: String, required: true },
            admin: { type: String, required: true },
            // Raised on every change to the zone or its records, so secondaries notice it.
            serial: { type: Number, required: true },
            refresh: { type: Number, required: true },
            retry: { type: Number, required: true },
            expire: { type: Number, required: true },
            ttl: { type: Number, required: true },
        },
    },
    { timestamps: true }
);

function toPublic(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
}

zoneSchema.set('toJSON', { transform: toPublic });

const Zone = mongoose.model('Zone', zoneSchema);

module.exports = Zone;
module.exports.toPublic = (plain) => toPublic(null, { ...plain });
