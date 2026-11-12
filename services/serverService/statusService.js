// What the DNS server has done since it was started, for the status page.
const startedAt = new Date();

const queries = { total: 0, zones: 0, forwarded: 0, failed: 0 };

// kind: 'zones' (answered from our own zones), 'forwarded' or 'failed'
function countQuery(kind) {
    queries.total++;
    queries[kind]++;
}

module.exports = { startedAt, queries, countQuery };
