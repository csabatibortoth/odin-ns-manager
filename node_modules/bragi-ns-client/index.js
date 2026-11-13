'use strict';

const Lookup = require('./src/Lookup');

const {BOGUS, INSECURE} = require('./src/dnssec/errors');

/**
 * Makes a `lookup` function with its own cache and settings.
 *
 * @param {Object} [options] - see the `Lookup` constructor
 * @returns {Function}
 */
const createLookup = options => {
    const instance = new Lookup(options);

    return instance.run.bind(instance);
};

const lookup = createLookup();

module.exports = {
    lookup,
    createLookup,
    DNSSEC_BOGUS:    BOGUS,
    DNSSEC_INSECURE: INSECURE
};
