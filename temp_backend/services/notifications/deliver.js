const { Op } = require('sequelize');
const { Notification, PushSubscription } = require('../../database/schemas');
const webPush = require('../../utils/webPush');
const logger = require('../../utils/logger');

/**
 * Drains the push queue: notification rows with pushed_at IS NULL, written by generator.js.
 *
 * The split matters. The generator decides WHAT to tell someone and is pure database work; this
 * decides whether a device buzzes. Keeping them apart means a push service being slow or down can
 * never stop the in-app inbox from filling, and Phase 1 ran usefully on its own for exactly that
 * reason.
 */

// A row older than this is never pushed. If delivery was broken for two hours, a student opening
// their phone should not receive a burst of reminders for talks that already finished — the inbox
// still has them, which is the right place for history.
const MAX_AGE_MINUTES = 120;

// Per tick. Bounds a burst: a backfill can write dozens of rows at once, and firing all of them at
// a device in one go is how notifications get switched off permanently.
const BATCH = 50;

// A device that keeps failing without a definitive 404/410 is retired after this many attempts.
const MAX_FAILURES = 5;

/**
 * The payload the service worker receives. Small on purpose: push payloads have size limits, and
 * nothing sensitive should sit in one — it is decrypted on a device that may be unlocked on a desk.
 * Titles and bodies here are the same ones already shown in the app, never anything more.
 */
const payloadFor = (n) => ({
    title: n.title,
    body: n.body || '',
    url: n.url || '/app/notifications',
    tag: n.dedup_key,       // lets a re-send REPLACE rather than stack a second banner
    id: String(n.id),
});

async function deliverPending() {
    const out = { considered: 0, sent: 0, devices: 0, gone: 0, failed: 0, skipped: 0 };
    if (!webPush.isConfigured()) return out;

    const since = new Date(Date.now() - MAX_AGE_MINUTES * 60000);
    const pending = await Notification.findAll({
        where: { pushed_at: null, created_at: { [Op.gte]: since } },
        order: [['id', 'ASC']],
        limit: BATCH,
    });
    out.considered = pending.length;
    if (!pending.length) {
        // Stamp anything too old so it is never reconsidered — otherwise the query re-scans the same
        // stale rows on every tick forever.
        await Notification.update(
            { pushed_at: new Date() },
            { where: { pushed_at: null, created_at: { [Op.lt]: since } } },
        );
        return out;
    }

    // One query for every device belonging to the users in this batch, rather than per notification.
    const userIds = [...new Set(pending.map((n) => String(n.user_id)))];
    const subs = await PushSubscription.findAll({ where: { user_id: { [Op.in]: userIds }, enabled: true } });
    const byUser = new Map();
    for (const s of subs) {
        const k = String(s.user_id);
        if (!byUser.has(k)) byUser.set(k, []);
        byUser.get(k).push(s);
    }

    for (const n of pending) {
        const devices = byUser.get(String(n.user_id)) || [];
        if (!devices.length) {
            // No device registered. Mark it done anyway: the inbox already has it, and leaving it
            // pending would make this user's rows accumulate in the queue indefinitely.
            await n.update({ pushed_at: new Date() });
            out.skipped++;
            continue;
        }

        const payload = payloadFor(n);
        for (const device of devices) {
            const result = await webPush.sendTo(device, payload);
            out.devices++;
            if (result.ok) {
                out.sent++;
                if (device.failure_count > 0) await device.update({ failure_count: 0, last_seen_at: new Date() });
                else await device.update({ last_seen_at: new Date() });
            } else if (result.gone) {
                // Definitively dead — remove it. See utils/webPush.js.
                out.gone++;
                await device.destroy();
            } else {
                out.failed++;
                const next = device.failure_count + 1;
                if (next >= MAX_FAILURES) await device.destroy();
                else await device.update({ failure_count: next });
            }
        }

        // Stamped regardless of per-device outcome: this notification has had its attempt. Retrying
        // it later would deliver a stale reminder, and the inbox is the durable record either way.
        await n.update({ pushed_at: new Date() });
    }

    if (out.sent || out.gone || out.failed) {
        logger.info({ push: out }, 'push delivery');
    }
    return out;
}

module.exports = { deliverPending };
