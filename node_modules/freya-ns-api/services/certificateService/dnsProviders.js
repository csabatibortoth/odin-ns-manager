// The places a DNS-01 challenge record can be written. A provider is an object with
// create(name, value), remove(name, value) and optionally visible(name, value): see dnsChallenge.js.
// Each entry builds its provider when it is needed, so a provider that is not used costs nothing.
const zones = require('./zonesProvider');

const config = require('../../config/config');
const cloudflare = require('./cloudflareProvider');
const delegation = require('./delegationProvider');
const rfc2136 = require('./rfc2136Provider');
const hook = require('./hookProvider');

const FACTORIES = {
    zones: zones.provider,
    delegation: () => delegation.createProvider({ zone: config.acmeDelegationZone, inner: zones.provider() }),
    hook: () => hook.createProvider({ program: config.acmeHook, timeoutSeconds: config.acmeHookTimeout }),
    rfc2136: () =>
        rfc2136.createProvider({
            server: config.acmeRfc2136Server,
            zone: config.acmeRfc2136Zone,
            keyName: config.acmeRfc2136KeyName,
            algorithm: config.acmeRfc2136KeyAlgorithm,
            secret: config.acmeRfc2136KeySecret,
            secretFile: config.acmeRfc2136KeyFile,
        }),
    cloudflare: () =>
        cloudflare.createProvider({
            token: config.acmeCloudflareToken,
            tokenFile: config.acmeCloudflareTokenFile,
            zoneId: config.acmeCloudflareZoneId,
        }),
};

const names = () => Object.keys(FACTORIES);

function get(name) {
    if (!name) {
        throw new Error(
            `FREYA_ACME_DNS_PROVIDER is required for the dns-01 challenge. Available: ${names().join(', ') || 'none yet'}.`
        );
    }
    if (!Object.hasOwn(FACTORIES, name)) {
        throw new Error(`FREYA_ACME_DNS_PROVIDER ${name} is not known. Available: ${names().join(', ') || 'none yet'}.`);
    }
    return FACTORIES[name]();
}

// Records a provider made for itself that a crash may have left behind: removed when the server starts.
async function removeLeftovers() {
    return zones.removeLeftovers();
}

module.exports = { get, names, FACTORIES, removeLeftovers, configureZones: zones.configure };
