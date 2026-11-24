const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const { visibleOnAuthoritative, visibleOnPublicResolvers } = require('./dnsChallenge');

// DNS-01 provider "hook": the TXT record of the challenge is set by a program of the administrator, for DNS that has no other
// way in (a registrar with a script, an internal tool, nsupdate with special options ...). See dnsChallenge.js for the interface.
//
// The hook is called as   <program> create|remove <name> <value>   and also gets them in the environment:
//   ACME_ACTION (create | remove), ACME_NAME (_acme-challenge.example.com), ACME_VALUE (the 43 characters of the TXT value),
//   ACME_DOMAIN (example.com, the name without _acme-challenge.).
// Exit code 0 means: done (for `create`: the record is published at the name servers). Anything else is a failure.
//
// Security rules of this file (the hook is a program that runs with the rights of this server):
//  - The path comes from the ENVIRONMENT (FREYA_ACME_HOOK), never from a request, a setting that can be changed through the API,
//    or an order. It must be absolute, a regular file that this server may execute, and not writable by group or others (nor
//    the folder it is in): nobody who can only write there can replace the program.
//  - The program is started WITHOUT a shell (execFile): the arguments are single arguments, no quoting, no expansion. The name and
//    the value are checked before (only _acme-challenge.* names of letters, digits, '-', '_' and dots; the value is 43 base64url characters).
//  - The environment of the hook is empty except PATH and the ACME_* variables: it does NOT get the environment of this server
//    (database address, API tokens, the key of another provider ...).
//  - A time limit (default 60 seconds, at most 300): then the program is killed. At most 16 KiB of its output is read.
//  - One call at a time: two hooks never run side by side (a wildcard and its base name need two values at one name).
//  - The error message holds the exit code (or signal) and at most 200 characters of the last line of the error output of the hook,
//    without control characters. It never holds the environment or the arguments.

const PREFIX = '_acme-challenge.';
const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 300;
const MAX_OUTPUT = 16 * 1024;
const SAFE_PATH = '/usr/local/bin:/usr/bin:/bin';

const NAME = /^_acme-challenge(\.[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?)+$/;
const VALUE = /^[A-Za-z0-9_-]{43}$/;

// Refuses a program that somebody else could have changed. `fsApi`, `uid` and `platform` are injected for the tests.
// The path is resolved first (symlinks followed), and then EVERY part of it is checked: the file, its folder and each folder above it up
// to the root. Each must be owned by root or by the user of this server and must not be writable by group or others. One exception for
// the folders ABOVE the immediate folder: a "sticky" folder owned by root (like /tmp, mode 1777) may be writable by everybody, because
// the sticky bit stops others from removing or renaming what is not theirs; the next folder below it is checked as usual.
// Not supported: Windows (permissions there are ACLs, which are not read here): the hook provider is refused until they are.
// What stays: between this check and the start of the program there is a short gap (execFile takes a path, not an open file). The path
// that is started is the RESOLVED one that was just checked, so a symlink cannot be swapped in that gap; replacing the file itself in the
// gap needs write access to its folder or a folder above, and that is what the rules above exclude.
function checkProgram(program, { fsApi = fs, uid = process.getuid ? process.getuid() : null, platform = process.platform } = {}) {
    if (!program || typeof program !== 'string') {
        throw new Error('The hook provider needs a program: set FREYA_ACME_HOOK to the absolute path of an executable file.');
    }
    if (platform === 'win32') {
        throw new Error('The hook provider is not available on Windows: the permissions of the program (ACLs) cannot be checked there yet. Use another provider.');
    }
    if (!path.isAbsolute(program) || program.includes('\0')) throw new Error('FREYA_ACME_HOOK must be an absolute path');
    let real;
    try {
        real = fsApi.realpathSync(program);
    } catch {
        throw new Error('FREYA_ACME_HOOK does not exist');
    }
    const stat = fsApi.statSync(real);
    if (!stat.isFile()) throw new Error('FREYA_ACME_HOOK must be a regular file');
    try {
        fsApi.accessSync(real, fs.constants.X_OK);
    } catch {
        throw new Error('FREYA_ACME_HOOK is not executable for this server');
    }
    const owned = (info) => info.uid === 0 || info.uid === uid;
    // the file and its folder: strict
    const folder = path.dirname(real);
    for (const item of [real, folder]) {
        const info = fsApi.statSync(item);
        if (info.mode & 0o022) throw new Error(`${item} is writable by group or others: the hook could be replaced. Use mode 755 or stricter (chmod go-w).`);
        if (!owned(info)) throw new Error(`${item} belongs to another user than root or the user of this server`);
    }
    // every folder above, up to the root
    for (let dir = path.dirname(folder); ; dir = path.dirname(dir)) {
        const info = fsApi.statSync(dir);
        const sticky = (info.mode & 0o1000) !== 0 && info.uid === 0;
        if ((info.mode & 0o022) && !sticky) throw new Error(`${dir}, above the hook, is writable by group or others: somebody could replace a folder on the way to it (chmod go-w, or move the hook).`);
        if (!owned(info)) throw new Error(`${dir}, above the hook, belongs to another user than root or the user of this server`);
        if (dir === path.dirname(dir)) break;
    }
    return real;
}

const lastLine = (text) => {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map((line) => line.replace(/[\u0000-\u001f\u007f]/g, ' ').trim())
        .filter(Boolean);
    return (lines[lines.length - 1] || '').slice(0, 200);
};

// options: { program, timeoutSeconds, execFileImpl, fsApi, uid, platform } - the last four are for the tests.
function createProvider(options = {}) {
    checkProgram(options.program, options); // fail at the start, not at the first order
    const seconds = Number(options.timeoutSeconds ?? DEFAULT_TIMEOUT_S);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_TIMEOUT_S) {
        throw new Error(`FREYA_ACME_HOOK_TIMEOUT must be between 1 and ${MAX_TIMEOUT_S} seconds`);
    }
    const run = options.execFileImpl || execFile;
    // calls wait for the one before
    let queue = Promise.resolve();

    function check(name, value) {
        if (typeof name !== 'string' || !name.startsWith(PREFIX) || !NAME.test(name) || name.length > 253) {
            throw new Error(`Only names that start with ${PREFIX} can be written: ${String(name).slice(0, 80)}`);
        }
        if (typeof value !== 'string' || !VALUE.test(value)) throw new Error('The value of a challenge record has the wrong form');
    }

    function call(action, name, value) {
        check(name, value);
        const job = queue.then(
            () =>
                new Promise((resolve, reject) => {
                    // Re-checked at every call: the file may have changed since the server started.
                    let program;
                    try {
                        program = checkProgram(options.program, options); // the resolved path that was just checked is the one that is started
                    } catch (err) {
                        return reject(err);
                    }
                    const env = {
                        PATH: SAFE_PATH,
                        ACME_ACTION: action,
                        ACME_NAME: name,
                        ACME_VALUE: value,
                        ACME_DOMAIN: name.slice(PREFIX.length),
                    };
                    run(
                        program,
                        [action, name, value],
                        { env, cwd: path.dirname(program), timeout: seconds * 1000, killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT, shell: false, windowsHide: true },
                        (err, stdout, stderr) => {
                            if (!err) return resolve();
                            const why = err.killed || err.code === 'ETIMEDOUT' ? `did not finish in ${seconds} seconds and was stopped` : err.signal ? `was stopped by ${err.signal}` : err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'wrote too much output' : typeof err.code === 'number' ? `failed with exit code ${err.code}` : `could not be started (${err.code || err.name})`;
                            const said = lastLine(stderr);
                            reject(new Error(`The DNS hook ${why} (${action} ${name})${said ? `: ${said}` : ''}`));
                        }
                    );
                })
        );
        queue = job.catch(() => {}); // the next call starts after this one, whatever happened
        return job;
    }

    return {
        // async: a bad name is a rejected promise, like every other failure
        create: async (name, value) => call('create', name, value),
        remove: async (name, value) => call('remove', name, value),
        // Published when the zone's own name servers have it; the public resolvers are the fallback.
        async visible(name, value) {
            const published = await visibleOnAuthoritative(name, value);
            return published ?? visibleOnPublicResolvers(name, value);
        },
    };
}

module.exports = { createProvider, checkProgram, MAX_TIMEOUT_S };
