// Reads the domains out of a downloaded block list. Three formats are understood, and may be mixed:
//   hosts file:    "0.0.0.0 ads.example.com"   (an address followed by one or more names)
//   domain list:   "ads.example.com"           (one name per line)
//   adblock rule:  "||ads.example.com^"
// Everything else - comments, the localhost names of a hosts file, other adblock rules - is skipped.
const net = require('net');

const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ADBLOCK_DOMAIN = /^\|\|([a-z0-9._-]+)\^$/;
// Cosmetic adblock rules, e.g. "example.com##.banner": they hide parts of a page, and block no domain.
const ADBLOCK_COSMETIC = /#[@?$%]?#/;
// The names a hosts file gives to the machine itself.
const LOCAL_NAMES = new Set(['localhost.localdomain', 'ip6-localhost', 'ip6-loopback']);

function toDomain(token) {
    const name = token.endsWith('.') ? token.slice(0, -1) : token;
    return DOMAIN.test(name) && !net.isIP(name) && !LOCAL_NAMES.has(name) ? name : null;
}

// Returns the set of the domains of the list, in lower case.
function parseBlockList(text) {
    const domains = new Set();
    const add = (token) => {
        const domain = toDomain(token);
        if (domain) domains.add(domain);
    };

    for (const rawLine of text.split(/\r?\n/)) {
        if (ADBLOCK_COSMETIC.test(rawLine)) continue;

        const hash = rawLine.indexOf('#');
        const line = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim().toLowerCase();
        if (!line || line.startsWith('!') || line.startsWith('[')) continue;

        const adblock = ADBLOCK_DOMAIN.exec(line);
        if (adblock) {
            add(adblock[1]);
            continue;
        }

        const tokens = line.split(/\s+/);
        if (net.isIP(tokens[0])) tokens.slice(1).forEach(add);
        else if (tokens.length === 1) add(tokens[0]);
    }
    return domains;
}

module.exports = { parseBlockList };
