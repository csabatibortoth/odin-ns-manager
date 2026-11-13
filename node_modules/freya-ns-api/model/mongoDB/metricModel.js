const mongoose = require('mongoose');

// The counters of the name server for one hour. They are raised as the queries are recorded, and
// are kept much longer than the queries themselves.
const metricSchema = new mongoose.Schema(
    {
        // The start of the hour, in UTC.
        time: { type: Date, required: true, unique: true },
        queries: { type: Number, default: 0 },
        blocked: { type: Number, default: 0 },
        // The sum of the durations, and the number of queries that had one: their ratio is the average.
        durationMs: { type: Number, default: 0 },
        timed: { type: Number, default: 0 },
        // The number of queries by response code, and by record type: { NOERROR: 12, NXDOMAIN: 1 }.
        statuses: { type: mongoose.Schema.Types.Mixed, default: {} },
        types: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    { versionKey: false, minimize: false }
);

module.exports = mongoose.model('Metric', metricSchema);
