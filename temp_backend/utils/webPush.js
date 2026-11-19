const webpush = require('web-push');
const logger = require('./logger');

/**
 * Web Push (VAPID) — the delivery half of notifications.
 *
 * Deliberately NOT Firebase or OneSignal: this is a W3C standard, `web-push` is self-contained, and
 * nothing about a student's notifications passes through a third party's account. Payloads are
 * encrypted to the device's own keys, so the push service relays bytes it cannot read.
 *
 * Disabled — silently and safely — until VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are set, so a
 * deployment without them behaves exactly as Phase 1 did rather than erroring on every tick.
 */
const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';

// mailto: is required by the spec — push services use it to contact the sender about a misbehaving
// application server. A real address matters if delivery is ever throttled.
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:st_cdc@iitr.ac.in';

let configured = false;
if (PUBLIC_KEY && PRIVATE_KEY) {
    try {
        webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
        configured = true;
    } catch (e) {
        logger.error({ err: e }, 'VAPID keys present but invalid — push stays disabled');
    }
}

const isConfigured = () => configured;
const publicKey = () => PUBLIC_KEY;

/**
 * Send one notification to one device.
 *
 * Returns { ok } or { ok:false, gone } — `gone` meaning the subscription is definitively dead and
 * the row should be DELETED, not retried. Browsers rotate endpoints constantly (a reinstall, a
 * profile reset, clearing site data), so without honouring 404/410 this table fills with corpses
 * that are re-sent to on every single tick, forever.
 *
 * Every other failure resolves with ok:false and gone:false — it might be transient, so the caller
 * counts it rather than discarding a device on one bad night.
 */
async function sendTo(subscription, payload) {
    if (!configured) return { ok: false, gone: false, reason: 'not-configured' };
    try {
        await webpush.sendNotification(
            {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            JSON.stringify(payload),
            { TTL: 60 * 60 * 12 },   // a reminder is worthless days later; let the service drop it
        );
        return { ok: true, gone: false };
    } catch (err) {
        const status = err?.statusCode;
        // 404 Not Found / 410 Gone — the endpoint no longer exists. This is the ONLY case where the
        // subscription should be removed; anything else may recover.
        const gone = status === 404 || status === 410;
        return { ok: false, gone, reason: `http-${status || 'err'}`, message: err?.message };
    }
}

module.exports = { isConfigured, publicKey, sendTo };
