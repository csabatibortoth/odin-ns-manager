// Which build of the server is running: { number, commit, date }.
//
//   1. ODIN_BUILD_NUMBER / ODIN_BUILD_COMMIT / ODIN_BUILD_DATE of the environment;
//   2. build.json, next to package.json - written by `npm run build-info`, for
//      the installations that are deployed without their git repository;
//   3. the git repository itself: the number of commits, and the last of them.
//
// A part that is not known is null.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const BUILD_FILE = path.join(ROOT, 'build.json');

function git(...args) {
    try {
        return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, windowsHide: true }).trim() || null;
    } catch {
        return null;
    }
}

function fromGit() {
    // Not the repository of a folder above, when this one is deployed without its own
    if (!fs.existsSync(path.join(ROOT, '.git'))) return {};
    return {
        number: git('rev-list', '--count', 'HEAD'),
        commit: git('rev-parse', '--short', 'HEAD'),
        date: git('log', '-1', '--format=%cI'),
    };
}

function fromFile() {
    try {
        const saved = JSON.parse(fs.readFileSync(BUILD_FILE, 'utf8'));
        return saved && typeof saved === 'object' ? saved : {};
    } catch {
        return {};
    }
}

function read() {
    const file = fromFile();
    const repository = file.number ? {} : fromGit();
    const text = (...values) => {
        const value = values.find((candidate) => candidate !== undefined && candidate !== null && candidate !== '');
        return value === undefined ? null : String(value).slice(0, 64);
    };
    return {
        number: text(process.env.ODIN_BUILD_NUMBER, file.number, repository.number),
        commit: text(process.env.ODIN_BUILD_COMMIT, file.commit, repository.commit),
        date: text(process.env.ODIN_BUILD_DATE, file.date, repository.date),
    };
}

// `node services/serverService/buildInfo.js` writes build.json from the repository
if (require.main === module) {
    const build = fromGit();
    if (!build.number) {
        console.error('This is not a git repository: build.json is not written');
        process.exit(1);
    }
    fs.writeFileSync(BUILD_FILE, `${JSON.stringify(build, null, 4)}\n`);
    console.log(`Build ${build.number} (${build.commit}) is written to ${BUILD_FILE}`);
}

module.exports = read();
