const dns = require('dns');

// DNS-01 provider "delegation": the DNS of the domain is hosted somewhere else (a registrar, any DNS provider) and
// this server cannot, or must not, write there. The owner adds ONE record at the real DNS, once, per name:
//
//   _acme-challenge.example.com   CNAME   _acme-challenge.example.com.<FREYA_ACME_DELEGATION_ZONE>
//
// The certificate authority follows the CNAME and looks for the TXT record in a zone of THIS server, where the
// provider "zones" writes it. It works with every DNS provider, needs no API key of the provider, and no key of the
// real domain ever reaches this machine. The zone of the delegation (e.g. acme.example.net) has to be hosted here
// and reachable from the internet as the authoritative name server of that name.

const PREFIX = '_acme-challenge.';
const PUBLIC_RESOLVERS = ['1.1.1.1', '8.8.8.8'];
const ZONE_NAME = /^(?=.{1,200}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

const clean = (name) => String(name).trim().toLowerCase().replace(/\.$/, '');

// The name of the TXT record in the zone of this server, for the name the authority is going to ask for.
function targetOf(name, zone) {
    if (!name.startsWith(PREFIX) || name.length <= PREFIX.length) throw new Error(`Only names that start with ${PREFIX} can be delegated: ${name}`);
    return `${name}.${zone}`;
}

// The record the owner has to add at the real DNS, for a name of FREYA_HTTPS_DOMAINS (a wildcard counts as its base name).
const recordToAdd = (domain, zone) => {
    const name = `${PREFIX}${String(domain).replace(/^\*\./, '').toLowerCase()}`;
    return { type: 'CNAME', name, target: targetOf(name, zone) };
};

// What the public DNS says about the CNAME, asked as the authority asks.
async function publicCname(name) {
    const seen = [];
    for (const server of PUBLIC_RESOLVERS) {
        const resolver = new dns.promises.Resolver({ timeout: 3000, tries: 1 });
        resolver.setServers([server]);
        const answer = await resolver.resolveCname(name).catch(() => []);
        seen.push(...answer.map(clean));
        if (seen.length) break;
    }
    return seen;
}

// options: { zone, inner (the provider that writes into the zone of this server), cname (async name -> [targets]) }
function createProvider({ zone, inner, cname = publicCname } = {}) {
    const delegationZone = clean(zone || '');
    if (!delegationZone) {
        throw new Error(
            'The delegation provider needs FREYA_ACME_DELEGATION_ZONE: a zone hosted on this server, e.g. acme.example.net, ' +
                'that the challenge records of the other domains point to.'
        );
    }
    if (!ZONE_NAME.test(delegationZone)) throw new Error(`FREYA_ACME_DELEGATION_ZONE is not a host name: ${zone}`);

    return {
        create: async (name, value) => inner.create(targetOf(name, delegationZone), value),
        remove: async (name, value) => inner.remove(targetOf(name, delegationZone), value),
        // visible: not given: public resolvers are asked for the TXT record at the name of the domain. They follow
        // the CNAME, so this is true only when the CNAME is in place AND this server answers for the target.

        // Said when the record did not become visible: which of the two is missing.
        async diagnose(name) {
            const target = targetOf(name, delegationZone);
            const found = await cname(name).catch(() => []);
            if (!found.length) {
                return `No CNAME was found at ${name}. Add this record at the DNS of the domain, once: ${name} CNAME ${target}`;
            }
            if (!found.includes(target)) {
                return `${name} is a CNAME to ${found.join(', ')}, but it has to be ${target}. Change the record at the DNS of the domain.`;
            }
            return (
                `The CNAME at ${name} is right, but the TXT record at ${target} is not answered. The zone ${delegationZone} ` +
                'has to be hosted on this server, and this server has to be reachable from the internet as its name server (NS record at the parent).'
            );
        },
    };
}

module.exports = { createProvider, recordToAdd, targetOf };
