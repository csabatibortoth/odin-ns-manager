// Every value can be overridden with an environment variable, so secrets
// do not have to live in this file outside of development.
const env = process.env;

const bool = (value, fallback) =>
    value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());

module.exports = Object.freeze({
    serverName: env.FREYA_SERVER_NAME || 'freya-ns-api-1',
    companyName: env.FREYA_COMPANY_NAME || 'YourCompany',

    secret: env.FREYA_SECRET || 'Test',
    tokenExpiresIn: env.FREYA_TOKEN_EXPIRES_IN || '1h',
    httpServerPort: Number(env.FREYA_HTTP_PORT) || 45451,
    httpsServerPort: Number(env.FREYA_HTTPS_PORT) || 45452,
    httpEnabled: bool(env.FREYA_HTTP_ENABLED, true),
    httpsEnabled: bool(env.FREYA_HTTPS_ENABLED, false),
    httpsKeyFile: env.FREYA_HTTPS_KEY || 'sslcert/server.key',
    httpsCertFile: env.FREYA_HTTPS_CERT || 'sslcert/server.crt',
    version: '2.2.0',
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

    // Roles that may change zones and records, comma separated. Every signed-in user may read them.
    dnsWriteRoles: (env.FREYA_DNS_WRITE_ROLES || 'admin').split(',').map((role) => role.trim()).filter(Boolean),

    // Created on startup when the user collection is empty. Without a password
    // a random one is generated and printed once to the console.
    defaultAdminUser: env.FREYA_ADMIN_USER || 'admin',
    defaultAdminEmail: env.FREYA_ADMIN_EMAIL || 'admin@localhost',
    defaultAdminPwd: env.FREYA_ADMIN_PWD || '',
});
