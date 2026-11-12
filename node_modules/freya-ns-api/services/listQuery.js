// Helpers shared by the list endpoints: paging, sorting and filter parsing.
const HttpError = require('./httpError');

const MAX_PAGE_SIZE = 100;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseBoolean(value, field) {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    throw new HttpError(400, `${field} must be true or false`);
}

function parsePaging(query) {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(query.limit, 10) || 20));
    return { page, limit };
}

// sort is a field name, prefixed with "-" for descending. Ties are broken by _id to keep pages stable.
function parseSort(query, sortable, fallback) {
    const param = typeof query.sort === 'string' ? query.sort : fallback;
    const descending = param.startsWith('-');
    const field = descending ? param.slice(1) : param;
    if (!sortable.has(field)) throw new HttpError(400, `sort must be one of: ${[...sortable].join(', ')}`);
    return { [field]: descending ? -1 : 1, _id: 1 };
}

// Runs a paged find and returns the list envelope every list endpoint answers with.
async function findPage(Model, filter, { page, limit }, sort, toPublic) {
    const [items, total] = await Promise.all([
        Model.find(filter)
            .sort(sort)
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        Model.countDocuments(filter),
    ]);
    return { items: items.map(toPublic), page, limit, total, pages: Math.ceil(total / limit) };
}

module.exports = { escapeRegex, parseBoolean, parsePaging, parseSort, findPage };
