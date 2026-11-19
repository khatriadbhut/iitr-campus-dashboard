const express = require('express');
const { Op } = require('sequelize');
const { Notification, UserNotificationPref, PushSubscription } = require('../database/schemas');
const { userData } = require('../middlewares/userAuth');
const { reviewScope } = require('../utils/reviewScope');
const webPush = require('../utils/webPush');

const router = express.Router();

// How many rows the centre returns. The list is a recent history, not an archive — anything older
// than this is reachable through the feed itself, so paginating it would be UI for its own sake.
const PAGE = 50;

/**
 * Preferences, with defaults materialised for a user who has never opened settings.
 *
 * Read is lazy rather than seeding a row at signup: back-filling every existing user on deploy is a
 * write we do not need, and the generator already treats a missing row as "defaults" via COALESCE.
 * So a row exists only once someone actually changes something.
 */
const defaults = (userId) => ({
    user_id: userId,
    todos: true,
    saved_items: true,
    campus_feed: true,
    campus_notices: 'important',
    review_queue: true,
});

// ── GET /notifications ───────────────────────────────────────────────────────
// The in-app centre. Newest first, plus the unread count the bell badge renders.
router.get('/', userData, async (req, res) => {
    try {
        const userId = req.user.user_id;
        const [rows, unread] = await Promise.all([
            Notification.findAll({
                where: { user_id: userId },
                order: [['created_at', 'DESC']],
                limit: PAGE,
                raw: true,
            }),
            Notification.count({ where: { user_id: userId, read_at: null } }),
        ]);
        res.json({ notifications: rows, unread });
    } catch (e) {
        console.error('notifications fetch failed:', e);
        res.status(500).json({ error: 'Could not fetch notifications' });
    }
});

// ── POST /notifications/read ─────────────────────────────────────────────────
// Marks specific ids read, or everything when no ids are given (the "mark all read" button).
// Scoped to the caller's own rows: an id belonging to someone else simply matches nothing.
router.post('/read', userData, async (req, res) => {
    try {
        const userId = req.user.user_id;
        const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : null;
        const where = { user_id: userId, read_at: null };
        if (ids && ids.length) where.id = { [Op.in]: ids.slice(0, 200) };
        const [updated] = await Notification.update({ read_at: new Date() }, { where });
        res.json({ ok: true, updated });
    } catch (e) {
        console.error('notification read failed:', e);
        res.status(500).json({ error: 'Could not update notifications' });
    }
});

// ── GET /notifications/prefs ─────────────────────────────────────────────────
// `canReview` tells the client whether to render the Review Queue section at all — a student with no
// admin scope should not see a toggle for something that will never fire.
router.get('/prefs', userData, async (req, res) => {
    try {
        const userId = req.user.user_id;
        const [row, scope] = await Promise.all([
            UserNotificationPref.findByPk(userId, { raw: true }),
            reviewScope(userId),
        ]);
        res.json({
            prefs: row || defaults(userId),
            canReview: scope.all || scope.clubIds.length > 0,
        });
    } catch (e) {
        console.error('notification prefs fetch failed:', e);
        res.status(500).json({ error: 'Could not fetch notification preferences' });
    }
});

// ── PUT /notifications/prefs ─────────────────────────────────────────────────
router.put('/prefs', userData, async (req, res) => {
    try {
        const userId = req.user.user_id;
        const b = req.body || {};
        const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

        // Whitelist every field. Spreading req.body would let a caller write user_id and take over
        // another account's preferences — the only field here that is not free to set.
        const current = (await UserNotificationPref.findByPk(userId, { raw: true })) || defaults(userId);
        const next = {
            user_id: userId,
            todos: bool(b.todos, current.todos),
            saved_items: bool(b.saved_items, current.saved_items),
            campus_feed: bool(b.campus_feed, current.campus_feed),
            campus_notices: ['off', 'important', 'all'].includes(b.campus_notices)
                ? b.campus_notices
                : current.campus_notices,
            review_queue: bool(b.review_queue, current.review_queue),
            updated_at: new Date(),
        };

        await UserNotificationPref.upsert(next);
        res.json({ prefs: next });
    } catch (e) {
        console.error('notification prefs update failed:', e);
        res.status(500).json({ error: 'Could not save notification preferences' });
    }
});

// ── GET /notifications/push-key ─────────────────────────────────────────────
// The VAPID PUBLIC key, which the browser needs to create a subscription. Public by design — it is
// compiled into every client anyway; the private half never leaves the server.
// `configured:false` lets the UI say "not available" rather than fail a subscribe call.
router.get('/push-key', userData, (req, res) => {
    res.json({ configured: webPush.isConfigured(), publicKey: webPush.publicKey() });
});

// ── POST /notifications/subscribe ───────────────────────────────────────────
// Registers THIS device. Upserted on `endpoint`: a browser that re-subscribes (reinstall, permission
// re-grant, key rotation) must replace its row, not add a second one — otherwise the table fills
// with duplicates that all get sent to.
router.post('/subscribe', userData, async (req, res) => {
    try {
        const { endpoint, keys } = req.body || {};
        if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2000) {
            return res.status(400).json({ error: 'Bad request', message: 'Invalid push endpoint' });
        }
        if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
            return res.status(400).json({ error: 'Bad request', message: 'Missing encryption keys' });
        }

        const existing = await PushSubscription.findOne({ where: { endpoint } });
        if (existing) {
            // Re-bind to the caller. The same physical browser can be handed to a different account,
            // and the endpoint is the device — leaving it on the previous user would send them
            // somebody else's notifications.
            await existing.update({
                user_id: req.user.user_id,
                p256dh: keys.p256dh,
                auth: keys.auth,
                user_agent: String(req.headers['user-agent'] || '').slice(0, 400),
                enabled: true,
                failure_count: 0,
                last_seen_at: new Date(),
            });
            return res.json({ ok: true, updated: true });
        }

        await PushSubscription.create({
            user_id: req.user.user_id,
            endpoint,
            p256dh: keys.p256dh,
            auth: keys.auth,
            user_agent: String(req.headers['user-agent'] || '').slice(0, 400),
            last_seen_at: new Date(),
        });
        res.json({ ok: true, created: true });
    } catch (e) {
        console.error('push subscribe failed:', e);
        res.status(500).json({ error: 'Could not register this device' });
    }
});

// ── POST /notifications/unsubscribe ─────────────────────────────────────────
// Scoped to the caller's own rows, so an endpoint belonging to someone else simply matches nothing.
router.post('/unsubscribe', userData, async (req, res) => {
    try {
        const { endpoint } = req.body || {};
        if (typeof endpoint !== 'string') return res.status(400).json({ error: 'Bad request' });
        const removed = await PushSubscription.destroy({
            where: { endpoint, user_id: req.user.user_id },
        });
        res.json({ ok: true, removed });
    } catch (e) {
        console.error('push unsubscribe failed:', e);
        res.status(500).json({ error: 'Could not remove this device' });
    }
});

module.exports = router;
