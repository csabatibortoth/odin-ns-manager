const mongoose = require('mongoose');

// One DNS query the name server answered. There are many of these, so they are kept small, and
// the old ones are deleted by the monitoring service after the retention time of the configuration.
const queryLogSchema = new mongoose.Schema(
    {
        time: { type: Date, required: true },
        // The address of the client that asked.
        client: { type: String, required: true },
        // The name that was asked for: lower case, without the trailing dot.
        name: { type: String, required: true },
        type: { type: String, required: true },
        // The response code of the answer, e.g. NOERROR or NXDOMAIN.
        status: { type: String, required: true },
        blocked: { type: Boolean, default: false },
        // How long the answer took; null when the name server did not measure it.
        durationMs: { type: Number, default: null },
    },
    { versionKey: false }
);

// The listing, newest first, and the deletion of the old queries.
queryLogSchema.index({ time: -1 });
// The queries of a client, and of a name.
queryLogSchema.index({ client: 1, time: -1 });
queryLogSchema.index({ name: 1, time: -1 });

function toPublic(doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    return ret;
}

queryLogSchema.set('toJSON', { transform: toPublic });

const QueryLog = mongoose.model('QueryLog', queryLogSchema);

module.exports = QueryLog;
module.exports.toPublic = (plain) => toPublic(null, { ...plain });
