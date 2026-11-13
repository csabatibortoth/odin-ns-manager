#!/usr/bin/env node
// Reads and writes the saved settings of an installation, for the installers
// of this folder. The settings go through config/config.js, so they are
// checked the way the Settings page of the user interface checks them, and
// stay changeable there afterwards.
//
//   node install/settings.js <settings file> get <key>
//   node install/settings.js <settings file> set <key>=<value> ...
//
// A list is written with commas. `set` changes nothing when one of the values
// is not valid: the reasons are printed, and the exit code is 1.
const [, , file, command, ...rest] = process.argv;

if (!file || !['get', 'set'].includes(command)) {
    console.error('usage: settings.js <settings file> get <key> | set <key>=<value> ...');
    process.exit(2);
}

// Nothing of the environment of the caller may fix a setting here. The key of
// the tokens is the exception: leaving DEV is refused without a private one.
for (const name of Object.keys(process.env)) {
    if (name.startsWith('ODIN_') && name !== 'ODIN_SECRET') delete process.env[name];
}
process.env.ODIN_SETTINGS_FILE = file;

const config = require('../config/config');
const settings = new Map(config.describe().groups.flatMap((group) => group.settings).map((setting) => [setting.key, setting]));

function typed(setting, text) {
    if (setting.type === 'bool') return ['1', 'true', 'yes', 'on', 'y'].includes(text.toLowerCase());
    if (setting.type === 'int') return /^-?\d+$/.test(text.trim()) ? Number(text) : text;
    if (setting.type === 'list') return text.split(',').map((item) => item.trim()).filter(Boolean);
    return text;
}

if (command === 'get') {
    const setting = settings.get(rest[0]);
    if (!setting) {
        console.error(`${rest[0]} is not a setting`);
        process.exit(1);
    }
    // What is saved wins over what a running server would still use
    const value = 'pending' in setting ? setting.pending : setting.value;
    console.log(Array.isArray(value) ? value.join(',') : String(value ?? ''));
} else {
    const changes = {};
    for (const pair of rest) {
        const at = pair.indexOf('=');
        const key = at < 0 ? pair : pair.slice(0, at);
        const setting = settings.get(key);
        // config.update names what is not a setting
        changes[key] = setting && at >= 0 ? typed(setting, pair.slice(at + 1)) : null;
    }
    try {
        config.update(changes);
    } catch (err) {
        console.error(err.details ? Object.values(err.details).join('\n') : err.message);
        process.exit(1);
    }
}
