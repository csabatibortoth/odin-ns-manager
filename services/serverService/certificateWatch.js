// Watches the certificate of HTTPS: sends a mail when it can not be renewed (or, for a certificate of your
// own, when it is about to expire), once, and again when it is fine. The renewal itself is the job of
// freya-ns-api; this only reads its status. The number of days is a metric as well: aesir.certificate.days_left.
const WARN_DAYS = 14;
const EVERY_MS = 30 * 60 * 1000;

// What is wrong with the certificate, or null. `status` is the answer of the certificate service.
function problem(status) {
    if (!status?.certificate) return null;
    if (status.lastError) return `The certificate could not be renewed: ${status.lastError}\nIt expires in ${status.certificate.daysLeft} day(s).`;
    if (status.certificate.daysLeft < WARN_DAYS) {
        return status.automaticRenewal
            ? `The certificate expires in ${status.certificate.daysLeft} day(s) and has not been renewed yet.`
            : `The certificate expires in ${status.certificate.daysLeft} day(s). It is not renewed automatically: replace it.`;
    }
    return null;
}

let timer = null;

// options: { status: () => the status or null, report: (job, failure, labels) } - the real ones are the defaults
function start({ status, report, every = EVERY_MS } = {}) {
    status ??= () => require('../apiService/apiService').certificateStatus();
    report ??= (...args) => require('./mailService').report(...args);
    const check = () => {
        try {
            report('certificate', problem(status()), { title: 'The certificate of HTTPS' });
        } catch {
            // Nothing to say when the status can not be read
        }
    };
    check();
    stop();
    timer = setInterval(check, every).unref();
    return check;
}

function stop() {
    clearInterval(timer);
    timer = null;
}

module.exports = { problem, start, stop, WARN_DAYS };
