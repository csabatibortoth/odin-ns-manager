#!/usr/bin/env node
// For the installers of this folder: prints how many user accounts the database has.
//
//   node install/users.js <environment file>
//
// The server makes the first admin account only when there are none, so the
// installers ask for its name and password in that case only. Prints nothing,
// and ends with code 1, when the database can not be asked.
const fs = require('fs');
const mongoose = require('mongoose');

function databaseUri(file) {
    let uri = process.env.FREYA_DB_URI || '';
    if (!file || !fs.existsSync(file)) return uri;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (line.startsWith('FREYA_DB_URI=')) uri = line.slice('FREYA_DB_URI='.length);
    }
    return uri;
}

async function main() {
    const uri = databaseUri(process.argv[2]);
    if (!uri) throw new Error('No database is set up.');
    const seconds = Number(process.env.ODIN_USERS_WAIT) || 10;
    const connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: seconds * 1000 }).asPromise();
    try {
        // The collection of the User model of freya-ns-api
        console.log(await connection.collection('users').countDocuments());
    } finally {
        await connection.close();
    }
}

main().then(
    () => process.exit(0),
    () => process.exit(1),
);
