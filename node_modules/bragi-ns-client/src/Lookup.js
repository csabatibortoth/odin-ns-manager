'use strict';

const dns = require('node:dns');

const AddressCache = require('./AddressCache');
const TasksManager = require('./TasksManager');
const ResolveTask  = require('./ResolveTask');

/**
 * @param {*} value
 * @returns {boolean}
 */
const isPlainObject = value => {
    if (value === null || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);

    return prototype === Object.prototype || prototype === null;
};

class Lookup {
    /**
     * @returns {number}
     */
    static get IPv4() {
        return 4;
    }

    /**
     * @returns {number}
     */
    static get IPv6() {
        return 6;
    }

    constructor() {
        this._addressCache = new AddressCache();
        this._tasksManager = new TasksManager();

        // Round-robin position per cached addresses list. Entries go away together with the list.
        this._cursors = new WeakMap();
    }

    /**
     * Lookup method that uses IP cache(and DNS TTL) to resolve hostname avoiding system call via thread pool.
     *
     * @param {string} hostname
     * @param {Object} options
     * @param {number} options.family
     * @param {boolean} options.all
     * @param {Function} callback
     * @throws {Error}
     * @returns {{}|undefined}
     */
    run(hostname, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options  = {};
        } else if (typeof options === 'number') {
            options = {family: options};
        } else if (!isPlainObject(options)) {
            throw new Error('options must be an object or an ip version number');
        }

        if (typeof callback !== 'function') {
            throw new Error('callback param must be a function');
        }

        if (!hostname) {
            if (options.all) {
                process.nextTick(callback, null, []);
            } else {
                process.nextTick(
                    callback,
                    null,
                    null,
                    options.family === Lookup.IPv6 ? Lookup.IPv6 : Lookup.IPv4
                );
            }

            return {};
        }

        if (typeof hostname !== 'string') {
            throw new Error('hostname must be a string');
        }

        const resultCb = result => options.all ? callback(null, result) : callback(null, result.address, result.family);

        switch (options.family) {
            case Lookup.IPv4:
            case Lookup.IPv6:
                this._resolve(hostname, options).then(resultCb, callback);

                break;
            case undefined:
                this._resolveBoth(hostname, options).then(resultCb, callback);

                break;
            default:
                throw new Error('invalid family number, must be one of the {4, 6} or undefined');
        }
    }

    /**
     * @param {string} hostname
     * @param {Object} options
     * @param {number} options.family
     * @param {boolean} options.all
     * @returns {Promise}
     * @private
     */
    async _resolve(hostname, options) {
        let records;

        try {
            records = await this._innerResolve(hostname, options.family);
        } catch (error) {
            if (error.code === dns.NODATA) {
                throw this._makeNotFoundError(hostname, error.syscall);
            }

            throw error;
        }

        if (options.all) {
            return records.map(({address, family}) => ({address, family}));
        }

        if (records.length === 0) {
            const error = new Error(
                `Empty "${options.family === Lookup.IPv4 ? 'A' : 'AAAA'}" records list for ${hostname}`
            );

            error.hostname = hostname;

            throw error;
        }

        const {address, family} = this._nextRecord(records);

        return {address, family};
    }

    /**
     * Returns cached addresses, or waits for the DNS query for this host and IP version.
     * Parallel calls share a single query.
     *
     * @param {string} hostname
     * @param {number} ipVersion
     * @returns {Promise<Address[]>}
     * @private
     */
    _innerResolve(hostname, ipVersion) {
        const key = `${hostname}_${ipVersion}`;

        const cachedAddresses = this._addressCache.find(key);

        if (cachedAddresses) {
            return Promise.resolve(cachedAddresses);
        }

        const runningTask = this._tasksManager.find(key);

        if (runningTask) {
            return runningTask.run();
        }

        const task = new ResolveTask(hostname, ipVersion);

        this._tasksManager.add(key, task);

        const pending = task.run();

        // Attached first, so the cache is filled and the task is released before any caller continues.
        pending.then(
            addresses => {
                this._addressCache.set(key, addresses);
                this._tasksManager.done(key);
            },
            () => this._tasksManager.done(key)
        );

        return pending;
    }

    /**
     * Picks records one by one in a round-robin manner.
     *
     * @param {Address[]} records - not empty list
     * @returns {Address}
     * @private
     */
    _nextRecord(records) {
        const cursor = this._cursors.get(records) || 0;

        this._cursors.set(records, (cursor + 1) % records.length);

        return records[cursor];
    }

    /**
     * @param {string} hostname
     * @param {Object} options
     * @param {boolean} options.all
     * @returns {Promise}
     * @private
     */
    async _resolveBoth(hostname, options) {
        const resolve = family => this._resolve(hostname, {...options, family}).catch(error => {
            if (error.code === dns.NOTFOUND) {
                return options.all ? [] : null;
            }

            throw error;
        });

        const [ipv4result, ipv6result] = await Promise.all([resolve(Lookup.IPv4), resolve(Lookup.IPv6)]);

        if (options.all) {
            const records = ipv4result.concat(ipv6result);

            if (records.length === 0) {
                throw this._makeNotFoundError(hostname);
            }

            return records;
        }

        const record = ipv4result || ipv6result;

        if (!record) {
            throw this._makeNotFoundError(hostname);
        }

        return record;
    }

    // noinspection JSMethodCanBeStatic
    /**
     * @param {string} hostname
     * @param {string} [syscall]
     * @returns {Error}
     */
    _makeNotFoundError(hostname, syscall) {
        const errorMessage = (syscall ? syscall + ' ' : '') + `${dns.NOTFOUND} ${hostname}`;
        const error        = new Error(errorMessage);

        error.hostname = hostname;
        error.code     = dns.NOTFOUND;
        error.errno    = dns.NOTFOUND;

        if (syscall) {
            error.syscall = syscall;
        }

        return error;
    }
}

module.exports = Lookup;
