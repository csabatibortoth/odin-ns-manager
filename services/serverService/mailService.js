// Sending e-mails: the notifications to the admins, the lost password mails and
// what the plugins send. The settings are read at every mail, so a change in the
// user interface is used at once. Nodemailer is only loaded when a mail is sent.
const config = require('../../config/config');

const SEND_TIMEOUT = 15000;

const logs = () => require('../apiService/apiService').logService;

function isConfigured() {
    return Boolean(config.mailEnabled && config.mailHost && config.mailFrom);
}

function transport() {
    const nodemailer = require('nodemailer');
    return nodemailer.createTransport({
        host: config.mailHost,
        port: config.mailPort,
        secure: config.mailSecurity === 'tls',
        requireTLS: config.mailSecurity === 'starttls',
        ignoreTLS: config.mailSecurity === 'none',
        auth: config.mailUser ? { user: config.mailUser, pass: config.mailPassword } : undefined,
        connectionTimeout: SEND_TIMEOUT,
        greetingTimeout: SEND_TIMEOUT,
        socketTimeout: SEND_TIMEOUT,
    });
}

// message: { to, subject, text, html? } - to is an address or a list of them.
// Resolves with the answer of the SMTP server; rejects when mail is not set up
// or the server refuses it.
async function send({ to, subject, text, html }) {
    if (!isConfigured()) throw Object.assign(new Error('E-mail is not set up: enable it, and set the SMTP server and the sender address'), { status: 409 });
    const recipients = [to].flat().filter(Boolean);
    if (!recipients.length) throw Object.assign(new Error('There is no recipient'), { status: 400 });

    const mailer = transport();
    try {
        const result = await mailer.sendMail({
            from: config.mailFrom,
            to: recipients,
            subject: `[${config.serverName}] ${subject}`,
            text,
            html,
        });
        return { accepted: result.accepted, rejected: result.rejected };
    } finally {
        mailer.close();
    }
}

// Sends a mail to the addresses of the settings. Never rejects: a notification
// that can not be sent is logged.
async function notify(subject, text) {
    if (!isConfigured() || !config.mailAdmins.length) return false;
    try {
        await send({ to: config.mailAdmins, subject, text });
        return true;
    } catch (err) {
        logs().addErrorLogErrorEntry('Notification could not be sent: ', err.message);
        return false;
    }
}

// Reports a failing job once, and again when it works: report('sync', null)
// when it works, report('sync', 'what failed') when it does not.
const failing = new Map();

function report(job, failure, labels) {
    const was = failing.has(job);
    if (failure) {
        if (was) return; // told already
        failing.set(job, failure);
        module.exports.notify(`${labels.title} failed`, `${labels.title} failed:\n\n${failure}\n\nA mail is sent again when it works.`);
    } else if (was) {
        failing.delete(job);
        module.exports.notify(`${labels.title} works again`, `${labels.title} works again.`);
    }
}

module.exports = { isConfigured, send, notify, report };
