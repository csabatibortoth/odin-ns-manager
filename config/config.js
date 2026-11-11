// Every value can be overridden with an environment variable, so secrets
// do not have to live in this file outside of development.
const env = process.env;

const bool = (value, fallback) =>
    value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());

const list = (value, fallback) =>
    value === undefined ? fallback : value.split(',').map((item) => item.trim()).filter(Boolean);

module.exports = Object.freeze({
    serverName: env.ODIN_SERVER_NAME || 'odin-ns-manager-1',
    companyName: env.ODIN_COMPANY_NAME || 'YourCompany',

    secret: env.ODIN_SECRET || 'Test',
    version: require('../package.json').version,
    type: env.ODIN_TYPE || 'DEV',

    // DNS server
    nsServerPort: Number(env.ODIN_NS_PORT) || 53,
    serverIPAddress: env.ODIN_NS_ADDRESS || '127.0.0.1',
    nsTcpEnabled: bool(env.ODIN_NS_TCP_ENABLED, true),

    // The DNS servers that are asked for the names this server does not know.
    // An empty list means the DNS servers of the system.
    nsUpstreamServers: list(env.ODIN_NS_UPSTREAM, ['1.1.1.1', '1.0.0.1']),
    nsUpstreamTimeout: Number(env.ODIN_NS_UPSTREAM_TIMEOUT) || 2000,
    nsUpstreamTries: Number(env.ODIN_NS_UPSTREAM_TRIES) || 2,

    // Answers are kept for their TTL, failed lookups for nsNegativeCacheTtl seconds
    nsCacheEnabled: bool(env.ODIN_NS_CACHE_ENABLED, true),
    nsCacheMaxEntries: Number(env.ODIN_NS_CACHE_MAX_ENTRIES) || 10000,
    nsNegativeCacheTtl: Number(env.ODIN_NS_NEGATIVE_CACHE_TTL) || 30,

    // Management API (freya-ns-api)
    apiEnabled: bool(env.ODIN_API_ENABLED, true),
    httpServerPort: Number(env.ODIN_HTTP_PORT) || 45451,
    httpsServerPort: Number(env.ODIN_HTTPS_PORT) || 45452,
    httpEnabled: bool(env.ODIN_HTTP_ENABLED, true),
    httpsEnabled: bool(env.ODIN_HTTPS_ENABLED, false),
    authEnabled: bool(env.ODIN_AUTH_ENABLED, true),

    modelServerType: 'MNG',
    modelServerAddress: env.ODIN_DB_ADDRESS || '127.0.0.1',
    modelServerPort: env.ODIN_DB_PORT || '27017',
    modelServerUser: env.ODIN_DB_USER ?? 'Test',
    modelServerPwd: env.ODIN_DB_PWD ?? 'Test',
    modelServerDataBase: env.ODIN_DB_NAME || 'odin-ns-manager-1',

    logingEnabled: bool(env.ODIN_LOGGING_ENABLED, true),
    basicLogFolder: env.ODIN_LOG_FOLDER || 'C:\\Temp\\Odin\\Logs',
});
