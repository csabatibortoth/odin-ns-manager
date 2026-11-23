// Addresses and ranges ("192.168.0.0/16"), with no dependencies: the settings use it to check a list, and the
// access service to apply it.
const net = require('net');

// A client written as a socket gives it: IPv4 in IPv6 form (::ffff:192.0.2.1) and a zone id (fe80::1%eth0) included
function normalize(address) {
    if (typeof address !== 'string') return null;
    const bare = address.replace(/%.*$/, '').replace(/^::ffff:/i, '');
    return net.isIP(bare) ? bare : null;
}

// One entry of a list: an address with an optional prefix length. Returns { address, prefix, family } or null.
function parseEntry(entry) {
    const [address, length, ...rest] = String(entry).trim().split('/');
    const family = net.isIP(address);
    if (!family || rest.length || (length !== undefined && !/^\d{1,3}$/.test(length))) return null;
    const max = family === 4 ? 32 : 128;
    const prefix = length === undefined ? max : Number(length);
    return prefix <= max ? { address, prefix, family: family === 4 ? 'ipv4' : 'ipv6' } : null;
}

// A net.BlockList of the valid entries of a list
function compile(list) {
    const blocks = new net.BlockList();
    for (const entry of list) {
        const parsed = parseEntry(entry);
        if (parsed) blocks.addSubnet(parsed.address, parsed.prefix, parsed.family);
    }
    return blocks;
}

const contains = (blocks, client) => blocks.check(client, net.isIPv4(client) ? 'ipv4' : 'ipv6');

module.exports = { normalize, parseEntry, compile, contains };
