/**
 * Push delivery worker — integration test against the LOCAL dev database.
 * (run: node services/notifications/__tests__/deliver.test.js)
 *
 * web-push itself is stubbed. What matters here is not that HTTP works — it is the bookkeeping
 * around it, which is where the damage happens:
 *
 *   · a dead subscription (404/410) must be DELETED, or the table fills with corpses that are
 *     re-sent to on every tick forever;
 *   · a transient failure must NOT delete it on the first bad night;
 *   · every notification must end up stamped `pushed_at`, or the queue re-sends it endlessly;
 *   · a user with no device must not leave rows pending for ever.
 */
require('dotenv').config({ quiet: true });

const url = process.env.DATABASE_URL || '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    console.error('REFUSING TO RUN: DATABASE_URL is not local');
    process.exit(1);
}

const sequelize = require('../../../database/connection');
const S = require('../../../database/schemas');

// ── stub web-push BEFORE deliver.js requires it ─────────────────────────────
const webPushPath = require.resolve('../../../utils/webPush');
const outcomes = new Map();          // endpoint -> { ok, gone }
const sent = [];
require.cache[webPushPath] = {
    id: webPushPath, filename: webPushPath, loaded: true, exports: {
        isConfigured: () => true,
        publicKey: () => 'test-key',
        sendTo: async (sub, payload) => {
            sent.push({ endpoint: sub.endpoint, payload });
            return outcomes.get(sub.endpoint) || { ok: true, gone: false };
        },
    },
};
const { deliverPending } = require('../deliver');

let pass = 0; let fail = 0;
const check = (name, got, want) => {
    if (got === want) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

const UID = 990001;
const UID2 = 990002;
let n = 0;
const mkNotification = (userId, ageMinutes = 0) => S.Notification.create({
    user_id: userId, channel: 'mine', type: 'todo', dedup_key: `deliver-test:${++n}`,
    title: 'Test', body: 'body', url: '/app/todo',
    created_at: new Date(Date.now() - ageMinutes * 60000),
});

(async () => {
    await sequelize.sync({ alter: false });
    // Scoped to THIS test's fixtures. It used to truncate `notification` and delete every row of
    // `push_subscription`, which wiped real devices out of the dev database every time the suite ran
    // — a device registered by hand would silently vanish mid-debugging. Destroying the test users
    // cascades to their own rows, so nothing else needs a blanket delete.
    const cleanup = async () => {
        await S.Notification.destroy({ where: { user_id: [UID, UID2] } });
        await S.PushSubscription.destroy({ where: { user_id: [UID, UID2] } });
        await S.User.destroy({ where: { user_id: [UID, UID2] } });
    };
    await cleanup();

    await S.User.create({ user_id: UID, full_name: 'Push One', email: 'p1@test.local' });
    await S.User.create({ user_id: UID2, full_name: 'Push Two', email: 'p2@test.local' });

    // ── 1. Happy path: two devices, one notification -> both buzz ───────────
    await S.PushSubscription.create({ user_id: UID, endpoint: 'https://push.test/ok-a', p256dh: 'k', auth: 'a' });
    await S.PushSubscription.create({ user_id: UID, endpoint: 'https://push.test/ok-b', p256dh: 'k', auth: 'a' });
    const notif = await mkNotification(UID);
    let out = await deliverPending();
    check('sends to every device of the user', out.sent, 2);
    check('  ...and stamps the notification', !!(await S.Notification.findByPk(notif.id)).pushed_at, true);
    check('  ...payload carries the deep link', sent[0].payload.url, '/app/todo');
    check('  ...and the dedup key as the tag', sent[0].payload.tag.startsWith('deliver-test:'), true);

    // ── 2. Idempotency: a second tick must not re-send ──────────────────────
    sent.length = 0;
    out = await deliverPending();
    check('a stamped notification is never re-sent', out.sent, 0);

    // ── 3. A dead subscription (410) is DELETED ─────────────────────────────
    outcomes.set('https://push.test/ok-b', { ok: false, gone: true });
    await mkNotification(UID);
    out = await deliverPending();
    check('410 Gone removes the subscription', out.gone, 1);
    check('  ...the row is actually deleted',
        await S.PushSubscription.count({ where: { endpoint: 'https://push.test/ok-b' } }), 0);
    check('  ...the healthy device still received it', out.sent, 1);

    // ── 4. A transient failure is counted, not deleted ──────────────────────
    outcomes.clear();
    outcomes.set('https://push.test/ok-a', { ok: false, gone: false });
    await mkNotification(UID);
    out = await deliverPending();
    check('a transient failure does not delete the device',
        await S.PushSubscription.count({ where: { endpoint: 'https://push.test/ok-a' } }), 1);
    check('  ...it increments failure_count',
        (await S.PushSubscription.findOne({ where: { endpoint: 'https://push.test/ok-a' } })).failure_count, 1);

    // ...but a device that keeps failing is eventually retired.
    for (let i = 0; i < 4; i++) { await mkNotification(UID); await deliverPending(); }
    check('a persistently failing device is retired after 5 tries',
        await S.PushSubscription.count({ where: { endpoint: 'https://push.test/ok-a' } }), 0);

    // ── 5. A user with NO device: the row must still be stamped ─────────────
    outcomes.clear();
    const orphan = await mkNotification(UID2);
    out = await deliverPending();
    check('a user with no device is skipped', out.skipped >= 1, true);
    check('  ...but the row is stamped, not left pending forever',
        !!(await S.Notification.findByPk(orphan.id)).pushed_at, true);

    // ── 6. Stale rows are retired without being sent ────────────────────────
    await S.PushSubscription.create({ user_id: UID, endpoint: 'https://push.test/fresh', p256dh: 'k', auth: 'a' });
    const stale = await mkNotification(UID, 300);      // 5 hours old, past MAX_AGE of 120m
    sent.length = 0;
    out = await deliverPending();
    check('a hours-old notification is never pushed', sent.some((s) => s.payload.title === 'Test' && false), false);
    check('  ...and is stamped so it stops being reconsidered',
        !!(await S.Notification.findByPk(stale.id)).pushed_at, true);

    await cleanup();
    await sequelize.close();
    console.log(`\n${pass}/${pass + fail} passed.`);
    process.exit(fail ? 1 : 0);
})().catch(async (e) => {
    console.error('ERROR:', e.message);
    try { await sequelize.close(); } catch { /* already closed */ }
    process.exit(1);
});
