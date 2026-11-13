// Every value can be overridden with an environment variable, so secrets
// do not have to live in this file outside of development.
const env = process.env;

const bool = (value, fallback) =>
    value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());

// A number that is not negative; unlike `Number(value) || fallback`, 0 is a value of its own.
const number = (value, fallback) => {
    const parsed = value === undefined || value === '' ? NaN : Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const roles = (value) => value.split(',').map((role) => role.trim()).filter(Boolean);

module.exports = Object.freeze({
    serverName: env.FREYA_SERVER_NAME || 'freya-ns-api-1',
    companyName: env.FREYA_COMPANY_NAME || 'YourCompany',

    secret: env.FREYA_SECRET || 'Test',
    tokenExpiresIn: env.FREYA_TOKEN_EXPIRES_IN || '1h',
    httpServerPort: Number(env.FREYA_HTTP_PORT) || 45451,
    httpsServerPort: Number(env.FREYA_HTTPS_PORT) || 45452,
    httpEnabled: bool(env.FREYA_HTTP_ENABLED, true),
    httpsEnabled: bool(env.FREYA_HTTPS_ENABLED, false),
    // Where the certificate of HTTPS comes from. letsencrypt: requested and renewed by the server itself.
    // custom: a private key and a certificate from anywhere else, in the two files below.
    httpsCertSource: (env.FREYA_HTTPS_CERT_SOURCE || 'letsencrypt').trim().toLowerCase(),
    // custom: the certificate file may hold the chain as well. The passphrase is for a key that is encrypted.
    httpsKeyFile: env.FREYA_HTTPS_KEY || 'sslcert/server.key',
    httpsCertFile: env.FREYA_HTTPS_CERT || 'sslcert/server.crt',
    httpsKeyPassphrase: env.FREYA_HTTPS_KEY_PASSPHRASE || '',
    // letsencrypt: the public names of this server the certificate is requested for, comma separated.
    httpsDomains: roles(env.FREYA_HTTPS_DOMAINS || '').map((domain) => domain.toLowerCase()),
    // letsencrypt: where the warnings about the certificate are sent. Optional.
    acmeEmail: env.FREYA_ACME_EMAIL || '',
    // letsencrypt: production, staging (for trying it out: no strict limits, but not trusted by browsers),
    // or the URL of the directory of another certificate authority that speaks ACME.
    acmeDirectory: (env.FREYA_ACME_DIRECTORY || 'production').trim(),
    // letsencrypt: the port that answers the challenge. The authority always connects to port 80 of the name:
    // change this only when that port is forwarded to another one.
    acmeHttpPort: number(env.FREYA_ACME_HTTP_PORT, 80),
    // letsencrypt: where the account key, the private key and the certificate are kept.
    acmeFolder: env.FREYA_ACME_FOLDER || 'sslcert/letsencrypt',
    version: '2.3.1',
    type: env.FREYA_TYPE || 'DEV',

    modelServerType: 'MNG',
    // A full connection string; when set it wins over the separate fields below.
    modelServerUri: env.FREYA_DB_URI || '',
    modelServerAddress: env.FREYA_DB_ADDRESS || '127.0.0.1',
    modelServerPort: env.FREYA_DB_PORT || '27017',
    // Leave the user empty to connect without authentication.
    modelServerUser: env.FREYA_DB_USER ?? 'Test',
    modelServerPwd: env.FREYA_DB_PWD ?? 'Test',
    modelServerDataBase: env.FREYA_DB_NAME || 'freya-ns-api-1',

    logingEnabled: bool(env.FREYA_LOGGING_ENABLED, true),
    basicLogFolder: env.FREYA_LOG_FOLDER || 'services/logService/logs',

    authEnabled: bool(env.FREYA_AUTH_ENABLED, true),

    // Roles that may change zones, records and the blocking, comma separated. Every signed-in user may read them.
    dnsWriteRoles: roles(env.FREYA_DNS_WRITE_ROLES || 'admin'),

    // When the block lists are downloaded again, as a cron expression. Empty: only on request.
    blockListRefreshCron: env.FREYA_BLOCKLIST_REFRESH_CRON ?? '0 4 * * *',
    // A download that is larger than this is refused.
    blockListMaxSizeMb: Number(env.FREYA_BLOCKLIST_MAX_SIZE_MB) || 64,

    // Roles that may use the monitoring: record and read the queries, the clients and the metrics.
    // The queries show what every client looks up, so this is not open to every signed-in user.
    monitoringRoles: roles(env.FREYA_MONITORING_ROLES || 'admin'),
    // How long a recorded query is kept, in days. 0: the queries are counted in the metrics, but not stored.
    queryLogRetentionDays: number(env.FREYA_QUERY_LOG_RETENTION_DAYS, 30),
    // How long the hourly metrics are kept, in days. 0: forever.
    metricsRetentionDays: number(env.FREYA_METRICS_RETENTION_DAYS, 365),

    // An import that is larger than this is refused.
    importMaxSizeMb: number(env.FREYA_IMPORT_MAX_SIZE_MB, 50) || 50,

    // The Swagger UI at /api/docs. It only describes the API; using the API still requires signing in.
    docsEnabled: bool(env.FREYA_DOCS_ENABLED, true),

    // Created on startup when the user collection is empty. Without a password
    // a random one is generated and printed once to the console.
    defaultAdminUser: env.FREYA_ADMIN_USER || 'admin',
    defaultAdminEmail: env.FREYA_ADMIN_EMAIL || 'admin@localhost',
    defaultAdminPwd: env.FREYA_ADMIN_PWD || '',
});
