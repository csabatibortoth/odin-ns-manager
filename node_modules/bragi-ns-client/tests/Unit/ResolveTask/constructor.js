'use strict';

const dns = require('node:dns');

const {assert} = require('chai');

const ResolveTask = require('../../../src/ResolveTask');
const addresses   = require('../../addresses');

describe('Unit: ResolveTask::constructor', () => {
    const hostname   = addresses.INET_HOST1;
    const ipVersions = [4, 6];

    ipVersions.forEach(ipVersion => {
        it(`must correct create resolve task for ipVersion === ${ipVersion}`, () => {
            const task = new ResolveTask(hostname, ipVersion);

            assert.strictEqual(task._hostname, hostname);
            assert.strictEqual(task._ipVersion, ipVersion);

            assert.strictEqual(task._resolver, ipVersion === 4 ? dns.promises.resolve4 : dns.promises.resolve6);
        });
    });

    [undefined, null, '', 1, {}].forEach(invalidHostname => {
        it(`must throw, cuz hostname is invalid (${JSON.stringify(invalidHostname)})`, () => {
            assert.throws(() => new ResolveTask(invalidHostname, 4), 'hostname must be not empty string');
        });
    });

    [undefined, 0, 5, '4'].forEach(invalidIpVersion => {
        it(`must throw, cuz ipVersion is invalid (${JSON.stringify(invalidIpVersion)})`, () => {
            assert.throws(() => new ResolveTask(hostname, invalidIpVersion), 'ipVersion must be 4 or 6');
        });
    });
});
