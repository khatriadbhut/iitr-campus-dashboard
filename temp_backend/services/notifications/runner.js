const { generate } = require('./generator');
const { deliverPending } = require('./deliver');
const logger = require('../../utils/logger');
const sentry = require('../../utils/sentry');

/**
 * The notification tick. Modelled directly on the Gmail ingestion poller, for the same reasons:
 *
 *  - Isolated. A throw inside generate() is logged and swallowed, never propagated. A bad row in one
 *    channel must not take the API process down with it.
 *  - Checked in. A poller that dies silently looks identical to a healthy one — health stays green,
 *    CPU stays flat, no error appears anywhere. The Sentry cron check-in is what turns "no
 *    notifications went out for three days" into an alert instead of a discovery.
 *
 * NOTIFY_TICK_SECONDS tunes the cadence; 60s matches the ingestion poller, so a notice ingested on
 * one tick is notified within about a minute.
 */
function startNotifications() {
    if (String(process.env.NOTIFICATIONS_ENABLED || 'true').toLowerCase() === 'false') {
        logger.info('notifications disabled (NOTIFICATIONS_ENABLED=false)');
        return;
    }

    const secs = Math.max(15, Number(process.env.NOTIFY_TICK_SECONDS) || 60);
    logger.info({ everySeconds: secs }, 'notification generator started');

    const tick = async () => {
        try {
            const out = await generate();
            // Generate first, then deliver, so anything created on THIS tick goes out on this tick
            // rather than waiting a full cycle. Delivery is isolated: a push service being down must
            // not stop the inbox being written.
            let push = null;
            try { push = await deliverPending(); }
            catch (e) { logger.error({ err: e }, 'push delivery failed'); }
            const total = Object.values(out).reduce((a, b) => a + b, 0) + (push?.sent || 0);
            // Only log a tick that did something. At 60s this would otherwise be 1,440 empty lines a
            // day, which is how the useful ones get lost — and the container log is capped at 30MB.
            if (total > 0) logger.info({ notify: out, pushed: push?.sent || 0 }, 'notification tick');
            sentry.workerCheckIn('notification-generator', 'ok', secs);
        } catch (e) {
            logger.error({ err: e }, 'notification tick failed');
            sentry.workerCheckIn('notification-generator', 'error', secs);
        }
    };

    tick();
    setInterval(tick, secs * 1000);
}

module.exports = { startNotifications };
