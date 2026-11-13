#!/usr/bin/env node
// Starts the server as a service, for the installers of this folder:
//
//   node install/launch.js <environment file>
//
// - Reads the environment file of the installation: lines of NAME=value. A
//   value is everything after the first "=", as it is, without quotes.
// - With ODIN_CONSOLE_LOG, what the server prints is written to that file as
//   well: a service on Windows has no console to look at.
// - Waits for the database before the server is started. The server keeps
//   running as a forwarder when it finds no database, and does not look for
//   it again; at boot the database may simply be the slower one.
const fs = require('fs');
const net = require('net');
const path = require('path');

const MAX_CONSOLE_LOG = 10 * 1024 * 1024;

function readEnvironment(file) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const at = line.indexOf('=');
        if (at < 1 || line.trimStart().startsWith('#')) continue;
        process.env[line.slice(0, at).trim()] = line.slice(at + 1);
    }
}

// Everything that is printed goes to the file too; one older file is kept
function logConsoleTo(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
        if (fs.statSync(file).size > MAX_CONSOLE_LOG) fs.renameSync(file, `${file}.1`);
    } catch {
        // There is no file yet
    }
    const log = fs.createWriteStream(file, { flags: 'a' });
    log.on('error', () => {});
    for (const stream of [process.stdout, process.stderr]) {
        const write = stream.write.bind(stream);
        stream.write = (chunk, ...rest) => {
            log.write(chunk);
            return write(chunk, ...rest);
        };
    }
    log.write(`\n--- started ${new Date().toISOString()} ---\n`);
}

// Where the database listens: of FREYA_DB_URI, or of the separate settings.
// null when it can not be told, as with mongodb+srv or a list of servers.
function databaseAddress() {
    const uri = process.env.FREYA_DB_URI;
    if (!uri) return { host: process.env.ODIN_DB_ADDRESS || '127.0.0.1', port: Number(process.env.ODIN_DB_PORT) || 27017 };
    try {
        const url = new URL(uri);
        if (url.protocol !== 'mongodb:' || !url.hostname) return null;
        return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) || 27017 };
    } catch {
        return null;
    }
}

const reachable = ({ host, port }) =>
    new Promise((resolve) => {
        const socket = net.connect({ host, port, timeout: 2000 });
        const done = (result) => {
            socket.destroy();
            resolve(result);
        };
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
    });

async function waitForDatabase() {
    const address = databaseAddress();
    const seconds = Number(process.env.ODIN_DB_WAIT ?? 60);
    if (!address || !(seconds > 0)) return;

    const until = Date.now() + seconds * 1000;
    for (let waited = false; !(await reachable(address)); waited = true) {
        if (Date.now() > until) {
            console.error(`The database at ${address.host}:${address.port} did not answer in ${seconds} seconds; starting without it.`);
            return;
        }
        if (!waited) console.log(`Waiting for the database at ${address.host}:${address.port} ...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
}

const file = process.argv[2] || process.env.ODIN_ENV_FILE;
if (file) readEnvironment(file);
if (process.env.ODIN_CONSOLE_LOG) logConsoleTo(process.env.ODIN_CONSOLE_LOG);

waitForDatabase().then(() => require('../server.js'));
