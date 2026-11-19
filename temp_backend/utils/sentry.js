/**
 * Sentry error-alerting — OPT-IN, off unless SENTRY_DSN is set (same fail-safe pattern as Groq/Gemini).
 * Sentry is the "smoke alarm": it captures exceptions + pings you. pino/CloudWatch is the continuous log.
 * They cooperate — a crash handler logs via pino AND captures here, then FLUSHES before the process exits
 * (else the alert never uploads).
 *   Env: SENTRY_DSN (enables it), SENTRY_ENV (defaults to NODE_ENV)
 */
const Sentry = require('@sentry/node');
const logger = require('./logger');

let enabled = false;

function initSentry() {
    const dsn = process.env.SENTRY_DSN;
    if (!dsn) { logger.info('Sentry disabled (no SENTRY_DSN)'); return; }
    Sentry.init({
        dsn,
        environment: process.env.SENTRY_ENV || process.env.NODE_ENV || 'development',
        // The git SHA of the running build, stamped by deploy.sh. Without it Sentry can't tie an error to
        // a deploy, sessions are discarded ("missing or non-string release"), and suspect commits stay
        // dead even with the GitHub integration connected.
        release: process.env.SENTRY_RELEASE || undefined,
        tracesSampleRate: 0,            // errors only for now — no perf tracing (keeps free-tier usage low)
    });
    enabled = true;
    logger.info('Sentry initialized');
}

// Non-exception alerts (a privilege change is not an error, but somebody must be told about it).
function captureMessage(message, context) {
    if (enabled) { try { Sentry.captureMessage(message, context); } catch { /* never let alerting crash the app */ } }
}

function captureException(err, context) {
    if (enabled) { try { Sentry.captureException(err, context); } catch { /* never let logging crash the app */ } }
}

// give Sentry a moment to upload before the process dies (crash-handler use)
async function flush(ms = 2000) {
    if (enabled) { try { await Sentry.flush(ms); } catch { /* best-effort */ } }
}

// Cron check-in for the Gmail poller — a missed check-in (poller silently died) alerts you. A dead
// poller is otherwise invisible: health stays green, CPU flat, the feed just quietly goes stale.
//
// The second argument UPSERTS the monitor, so the alert configures itself on first check-in instead of
// needing someone to hand-create a monitor whose slug exactly matches this string. Interval tracks
// INGEST_POLL_SECONDS (default 15 min) rounded to whole minutes, since Sentry schedules in minutes.
const pollMinutes = () => {
    const secs = Number(process.env.INGEST_POLL_SECONDS) || Number(process.env.INGEST_POLL_MINUTES || 15) * 60;
    const n = Math.round(secs / 60);
    // Math.max(1, NaN) is NaN, which serializes to null and makes Sentry reject the upsert — leaving
    // the dead-poller alert dead, the exact failure this is here to prevent. Fall back to the default.
    return Number.isFinite(n) && n >= 1 ? n : 15;
};

// An 'in_progress' check-in must be CLOSED by passing its id back with the terminal status. Without
// the id Sentry opens a second, unrelated check-in and the first dangles — then maxRuntime marks it
// timed-out, so a perfectly healthy poller would flap the monitor red on every single cycle.
let openCheckInId;
function pollerCheckIn(status /* 'in_progress' | 'ok' | 'error' */) {
    if (!enabled) return undefined;
    try {
        if (status === 'in_progress') {
            openCheckInId = Sentry.captureCheckIn({ monitorSlug: 'gmail-ingestion-poller', status }, {
                schedule: { type: 'interval', value: pollMinutes(), unit: 'minute' },
                checkinMargin: 5,    // minutes late before it counts as missed — absorbs a slow Gmail call
                maxRuntime: 10,      // a run wedged this long is a hang, not a slow run
                timezone: 'Asia/Kolkata',
            });
            return openCheckInId;
        }
        const id = Sentry.captureCheckIn({ checkInId: openCheckInId, monitorSlug: 'gmail-ingestion-poller', status });
        openCheckInId = undefined;
        return id;
    } catch { return undefined; }
}

/**
 * Cron check-in for any OTHER recurring worker, each under its own monitor slug.
 *
 * pollerCheckIn above is hardcoded to 'gmail-ingestion-poller' and pairs an in_progress with a
 * terminal status. Reusing it from a second worker would file both workers' runs against the same
 * monitor — so a dead ingestion poller would look alive because notifications were still ticking,
 * which defeats the entire point of having the alert.
 *
 * This is a single terminal ping rather than an open/close pair: these runs are short, so there is
 * no long window in which "started but never finished" is meaningful.
 */
function workerCheckIn(monitorSlug, status /* 'ok' | 'error' */, intervalSeconds = 60) {
    if (!enabled) return undefined;
    try {
        return Sentry.captureCheckIn({ monitorSlug, status }, {
            schedule: { type: 'interval', value: Math.max(1, Math.round(intervalSeconds / 60)), unit: 'minute' },
            checkinMargin: 5,
            maxRuntime: 10,
            timezone: 'Asia/Kolkata',
        });
    } catch { return undefined; }
}

module.exports = { Sentry, initSentry, captureException, captureMessage, flush, pollerCheckIn, workerCheckIn, isEnabled: () => enabled };
