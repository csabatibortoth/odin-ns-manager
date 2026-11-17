// Delivery to Heimdall: POST /v1/ingest/<format> with the UID and the license key of the agent.
//
// - The key only goes over https (http for this machine, or when it was allowed). Redirects are
//   never followed, so the key can not be forwarded to another server.
// - Batches that can not be delivered wait in memory (at most MAX_QUEUED, the oldest are dropped
//   first) and are tried again with a growing pause. A rejection that will not change (400, 413)
//   drops the batch instead of repeating it forever.
const MAX_BATCH = 500;
const MAX_QUEUED = 200;
const TIMEOUT_MS = 15000;
const MIN_BACKOFF_MS = 10000;
const MAX_BACKOFF_MS = 300000;
const PERMANENT = new Set([400, 413, 415, 422]);
const REASONS = {
    401: 'The agent UID or the license key is wrong, or the agent was revoked',
    402: 'The subscription of the organization has ended, or its agent limit is reached',
    429: 'Heimdall is slowing this agent down',
};

function createSender({ settings, fetchImpl = globalThis.fetch, now = Date.now, log = {} }) {
    const queue = [];
    const state = { sent: 0, dropped: 0, failures: 0, lastSuccess: null, lastError: null, nextAttempt: 0, backoff: 0, sending: false };

    function enqueue(format, items) {
        for (let at = 0; at < items.length; at += MAX_BATCH) queue.push({ format, items: items.slice(at, at + MAX_BATCH) });
        while (queue.length > MAX_QUEUED) {
            state.dropped += queue.shift().items.length;
            state.lastError = 'Too much waited for Heimdall: the oldest was dropped';
        }
    }

    async function post(batch) {
        const { url, agentUid, licenseKey } = settings.get();
        const body = batch.format === 'metrics' ? { metrics: batch.items } : batch.items;
        const response = await fetchImpl(`${url}/v1/ingest/${batch.format}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-agent-uid': agentUid, 'x-license-key': licenseKey },
            body: JSON.stringify(body),
            redirect: 'error',
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        // Read to the end so the connection can be reused; never shown, as it can echo input
        await response.text().catch(() => '');
        return response.status;
    }

    function fail(reason) {
        state.failures += 1;
        state.lastError = reason;
        state.backoff = Math.min(MAX_BACKOFF_MS, Math.max(MIN_BACKOFF_MS, state.backoff * 2));
        state.nextAttempt = now() + state.backoff;
    }

    // Sends what waits, in order, until it is empty or a batch fails. Never throws.
    async function flush({ force = false } = {}) {
        if (state.sending || !settings.configured() || (!force && now() < state.nextAttempt)) return;
        state.sending = true;
        try {
            while (queue.length) {
                let status;
                try {
                    status = await post(queue[0]);
                } catch (err) {
                    fail(err.name === 'TimeoutError' ? 'Heimdall did not answer in time' : `Heimdall can not be reached (${err.cause?.code || err.message})`);
                    return;
                }
                if (status === 200 || status === 202) {
                    state.sent += queue.shift().items.length;
                    state.lastSuccess = new Date(now()).toISOString();
                    state.lastError = null;
                    state.backoff = 0;
                    state.nextAttempt = 0;
                } else if (PERMANENT.has(status)) {
                    state.dropped += queue.shift().items.length;
                    state.lastError = `Heimdall refused a batch (HTTP ${status}), it was dropped`;
                    log.error?.(state.lastError);
                } else {
                    fail(`${REASONS[status] || 'Heimdall answered with an error'} (HTTP ${status})`);
                    return;
                }
            }
        } finally {
            state.sending = false;
        }
    }

    return {
        enqueue,
        flush,
        clear: () => { queue.length = 0; },
        state: () => ({ ...state, queued: queue.reduce((sum, batch) => sum + batch.items.length, 0) }),
    };
}

module.exports = { createSender, MAX_BATCH, MAX_QUEUED };
