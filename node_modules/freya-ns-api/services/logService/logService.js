const fs = require('fs');
const path = require('path');
const util = require('util');
const config = require('../../config/config');

const TARGETS = ['log', 'error', 'security'];
const LEVELS = ['info', 'warn'];

const noop = { info() {}, warn() {} };
let loggers = TARGETS.map(() => noop);

if (config.logingEnabled) {
    const winston = require('winston');
    const DailyRotateFile = require('winston-daily-rotate-file');

    const dirname = path.resolve(__dirname, '../..', config.basicLogFolder);
    fs.mkdirSync(dirname, { recursive: true });

    const format = winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
        winston.format.printf((entry) => `${entry.timestamp} ${entry.level.toUpperCase().padEnd(5)} ${entry.message}`)
    );

    // One file per target and day, e.g. security-2026.11.11.log
    loggers = TARGETS.map((name) =>
        winston.createLogger({
            format,
            transports: [new DailyRotateFile({ dirname, filename: `${name}-%DATE%.log`, datePattern: 'YYYY.MM.DD' })],
        })
    );
}

const toText = (part) => (typeof part === 'string' ? part : util.inspect(part));

// logTargetType: 0 = log, 1 = error, 2 = security; logType: 0 = info, 1 = warn
function addLogEntry(logTargetType, logType, ...logText) {
    const logger = loggers[logTargetType];
    const level = LEVELS[logType];
    if (logger && level) logger[level](logText.map(toText).join(''));
}

const addInfoLogBasicInfoEntry = (...logText) => addLogEntry(0, 0, ...logText);
const addErrorLogErrorEntry = (...logText) => addLogEntry(1, 1, ...logText);
const addSecurityLogInfoEntry = (...logText) => addLogEntry(2, 0, ...logText);
const addSecurityLogWarnEntry = (...logText) => addLogEntry(2, 1, ...logText);

function serverStartedLog() {
    for (let target = 0; target < TARGETS.length; target++) {
        addLogEntry(target, 0, 'Server Started! - ', config.version);
    }
}

module.exports = {
    addLogEntry,
    addErrorLogErrorEntry,
    addInfoLogBasicInfoEntry,
    addSecurityLogInfoEntry,
    addSecurityLogWarnEntry,
    serverStartedLog,
};
