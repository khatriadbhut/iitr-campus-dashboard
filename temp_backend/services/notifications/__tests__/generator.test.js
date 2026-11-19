/**
 * Notification generator — integration test against the LOCAL dev database.
 * (run: node services/notifications/__tests__/generator.test.js)
 *
 * Refuses to run against anything that is not localhost, because it creates and deletes rows.
 *
 * The behaviour that matters most here is the watermark seeding. Switching this feature on must NOT
 * treat the existing backlog as new — 9 events and 50 notices today, far more later. So the first
 * generate() call seeds watermarks to the current maximum and notifies nothing; only rows created
 * AFTER that produce notifications. Both halves are asserted.
 */
require('dotenv').config({ quiet: true });

const url = process.env.DATABASE_URL || '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    console.error(`REFUSING TO RUN: DATABASE_URL is not local (${url.replace(/:\/\/[^@]*@/, '://***@')})`);
    process.exit(1);
}

const sequelize = require('../../../database/connection');
const S = require('../../../database/schemas');
const gen = require('../generator');

let pass = 0; let fail = 0;
const check = (name, got, want) => {
    if (got === want) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

const TAG = 'notiftest';
const notifsFor = (userId) => S.Notification.findAll({ where: { user_id: userId }, raw: true });

(async () => {
    await sequelize.sync({ alter: false });

    // ── clean slate ──────────────────────────────────────────────────────────
    // Scoped to THIS test's fixtures. It used to truncate `notification` and delete EVERY event,
    // notice, club and user in the database — which repeatedly wiped hand-seeded dev data (the
    // 'Test Club' and its events kept vanishing mid-session). Fixtures are tagged, and the two test
    // users cascade to their own reminders, todos and notifications.
    const { Op } = require('sequelize');
    const tagged = { name: { [Op.like]: `%${TAG}%` } };
    const cleanup = async () => {
        await S.Notification.destroy({ where: { user_id: [900001, 900002] } });
        await S.NoticeReminder.destroy({ where: { user_id: [900001, 900002] } });
        await S.Reminder.destroy({ where: { user_id: [900001, 900002] } });
        await S.UserTodo.destroy({ where: { user_id: [900001, 900002] } });
        await S.UserNotPreferredClub.destroy({ where: { user_id: [900001, 900002] } });
        await S.UserNotificationPref.destroy({ where: { user_id: [900001, 900002] } });
        await S.Event.destroy({ where: tagged });
        await S.Notice.destroy({ where: { title: { [Op.like]: `%${TAG}%` } } });
        await S.Club.destroy({ where: tagged });
        await S.User.destroy({ where: { user_id: [900001, 900002] } });
        // Watermarks must go, or the next run starts above its own fixtures and notifies nothing.
        await S.IngestionState.destroy({ where: { key: { [Op.like]: 'notify:%' } } });
    };
    await cleanup();

    const club = await S.Club.create({ name: `${TAG} club`, is_fest: false });
    const other = await S.Club.create({ name: `${TAG} muted club`, is_fest: false });
    const alice = await S.User.create({ user_id: 900001, full_name: 'Alice Test', email: 'alice@notiftest.local' });
    const bob = await S.User.create({ user_id: 900002, full_name: 'Bob Test', email: 'bob@notiftest.local' });

    // Bob mutes the second club. Alice mutes nothing.
    await S.UserNotPreferredClub.create({ user_id: bob.user_id, club_id: other.id });

    // ── 1. First run seeds watermarks and must notify NOTHING ────────────────
    // Create content BEFORE the first generate(); it represents the pre-existing backlog.
    const backlogEvent = await S.Event.create({
        name: `${TAG} backlog event`, club_id: club.id,
        tentative_start_time: new Date(Date.now() + 86400000), duration_minutes: 60,
    });
    const first = await gen.generate();
    check('first run notifies nothing (backlog not blasted)', first.events + first.notices, 0);
    check('  ...and alice has no notifications', (await notifsFor(alice.user_id)).length, 0);

    // ── 2. Content created AFTER the watermark does notify ───────────────────
    const newEvent = await S.Event.create({
        name: `${TAG} new event`, club_id: club.id,
        tentative_start_time: new Date(Date.now() + 86400000), duration_minutes: 60,
    });
    const mutedEvent = await S.Event.create({
        name: `${TAG} muted club event`, club_id: other.id,
        tentative_start_time: new Date(Date.now() + 86400000), duration_minutes: 60,
    });
    const second = await gen.generate();
    check('new events notify', second.events > 0, true);

    // Feed items are COALESCED, so "how many did you get" is item_count on one batch row, not a row
    // count. The mute assertions are the point of this block and are unchanged in meaning: alice sees
    // both events, bob sees only the one whose club he has not muted.
    const aliceFeed = (await notifsFor(alice.user_id)).filter((n) => n.channel === 'feed');
    const bobFeed = (await notifsFor(bob.user_id)).filter((n) => n.channel === 'feed');
    const count = (rows) => rows.reduce((a, r) => a + r.item_count, 0);
    check('alice (no mutes) gets both new events', count(aliceFeed), 2);
    check('bob gets exactly one — the un-muted club', count(bobFeed), 1);
    check('bob does NOT get the muted club event',
        bobFeed.some((n) => n.url === `/app/event/${mutedEvent.id}`), false);
    check('backlog event never notified anyone',
        aliceFeed.some((n) => n.url === `/app/event/${backlogEvent.id}`), false);

    // ── 3. Idempotency: running again creates nothing new ────────────────────
    const before = (await notifsFor(alice.user_id)).length;
    await gen.generate();
    check('re-running the tick is a no-op', (await notifsFor(alice.user_id)).length, before);

    // ── 4. Notices honour the important-only default ─────────────────────────
    await S.Notice.create({ title: `${TAG} general notice`, club_id: club.id, priority: 'general', published_at: new Date() });
    await S.Notice.create({ title: `${TAG} important notice`, club_id: club.id, priority: 'important', published_at: new Date() });
    await gen.generate();
    const aliceNotices = (await notifsFor(alice.user_id)).filter((n) => n.type === 'notice');
    check('default (important only) delivers the important notice', aliceNotices.length, 1);
    check('  ...and it is the important one', aliceNotices[0].title, 'Important notice');

    // Bob opts into ALL notices, then a new general one arrives.
    await S.UserNotificationPref.upsert({ user_id: bob.user_id, campus_notices: 'all' });
    await S.Notice.create({ title: `${TAG} second general`, club_id: club.id, priority: 'general', published_at: new Date() });
    await gen.generate();
    // Bob is on 'all', so the general notice reaches him — as a second item in his notice batch,
    // which is why this counts items rather than matching a title.
    const bobNotices = (await notifsFor(bob.user_id)).filter((n) => n.type === 'notice');
    check('a user set to "all" gets the general notice too', count(bobNotices) >= 2, true);
    check('a user on the default does not',
        (await notifsFor(alice.user_id)).filter((n) => n.type === 'notice')
            .reduce((a, r) => a + r.item_count, 0), 1);

    // ── 5. Todo at its due time, no lead time ────────────────────────────────
    // Due 30 minutes ago, expressed in IST. Derived via Intl rather than arithmetic on the local
    // clock: a fixed '00:01' made this pass in the morning and fail in the evening (the generator
    // ignores anything older than STALE_AFTER_HOURS), and hand-rolled offset maths double-counts on
    // a machine that is already in IST.
    const istParts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(Date.now() - 30 * 60000))
        .reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    const todo = await S.UserTodo.create({
        user_id: alice.user_id, text: `${TAG} submit the form`, completed: false,
        due_date: `${istParts.year}-${istParts.month}-${istParts.day}`,
        due_time: `${istParts.hour}:${istParts.minute}`,
    });
    await gen.generate();
    const aliceTodos = (await notifsFor(alice.user_id)).filter((n) => n.type === 'todo');
    check('a due todo notifies its owner', aliceTodos.length, 1);
    check('  ...keyed on the todo', aliceTodos[0].dedup_key, `todo:${todo.id}`);
    check('  ...and only its owner', (await notifsFor(bob.user_id)).filter((n) => n.type === 'todo').length, 0);

    // ── 6. Reminder on a belled event ────────────────────────────────────────
    await S.Reminder.create({
        event_id: newEvent.id, user_id: alice.user_id, offset_minutes: 30,
        reminder_time: new Date(Date.now() - 60000),   // due one minute ago
    });
    await gen.generate();
    const aliceReminders = (await notifsFor(alice.user_id)).filter((n) => n.type === 'reminder');
    check('a due reminder notifies', aliceReminders.length, 1);
    check('  ...keyed on event AND offset', aliceReminders[0].dedup_key, `reminder:${newEvent.id}:30`);

    // ── 7. Preferences actually suppress ─────────────────────────────────────
    await S.UserNotificationPref.upsert({ user_id: alice.user_id, campus_feed: false });
    await S.Event.create({
        name: `${TAG} after opt-out`, club_id: club.id,
        tentative_start_time: new Date(Date.now() + 86400000), duration_minutes: 60,
    });
    const beforeOptOut = (await notifsFor(alice.user_id)).filter((n) => n.channel === 'feed').length;
    await gen.generate();
    check('campus_feed=false stops feed notifications',
        (await notifsFor(alice.user_id)).filter((n) => n.channel === 'feed').length, beforeOptOut);

    // ── 8. Notice reminders (the path that used to be localStorage-only) ─────
    const noticeForBell = await S.Notice.create({
        title: `${TAG} scholarship closes soon`, club_id: club.id, priority: 'general',
        published_at: new Date(), deadline: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    });
    await gen.generate();   // absorb the feed notification for it, so the next count is unambiguous
    await S.NoticeReminder.create({
        notice_id: noticeForBell.id, user_id: bob.user_id, offset_minutes: 30,
        reminder_time: new Date(Date.now() - 60000),   // due one minute ago
    });
    await gen.generate();
    const bobNoticeReminders = (await notifsFor(bob.user_id))
        .filter((n) => n.dedup_key === `notice-reminder:${noticeForBell.id}:30`);
    check('a due NOTICE reminder notifies', bobNoticeReminders.length, 1);
    check('  ...links to the notice', bobNoticeReminders[0].url, `/app/notices/${noticeForBell.id}`);
    check('  ...and says "Closes in" for a deadline', bobNoticeReminders[0].body, 'Closes in 30 minutes');
    check('  ...only its owner', (await notifsFor(alice.user_id))
        .filter((n) => n.dedup_key.startsWith('notice-reminder:')).length, 0);

    // Idempotency for this source too.
    const beforeNr = (await notifsFor(bob.user_id)).length;
    await gen.generate();
    check('notice reminders do not re-fire', (await notifsFor(bob.user_id)).length, beforeNr);

    // ── 9. Coalescing: a burst becomes ONE notification, not one each ────────
    // The scenario this exists for: an admin clears a review queue and publishes several events in
    // one sitting. Before batching that was one push per approval to every student.
    //
    // Own clean state: section 7 turned alice's feed OFF, and earlier sections already opened a
    // batch in this same ten-minute window, so inheriting either would measure the wrong thing.
    await S.UserNotificationPref.upsert({ user_id: alice.user_id, campus_feed: true, campus_notices: 'important' });
    await S.Notification.destroy({ where: { user_id: [900001, 900002] } });
    await S.IngestionState.destroy({ where: { key: 'notify:last_event_id' } });
    await gen.generate();                                   // re-seed the watermark, notify nothing

    const burst = [];
    for (let i = 0; i < 4; i++) {
        burst.push(await S.Event.create({
            name: `${TAG} burst event ${i}`, club_id: club.id,
            tentative_start_time: new Date(Date.now() + 86400000), duration_minutes: 60,
        }));
    }
    const beforeBurst = (await notifsFor(alice.user_id)).length;
    await gen.generate();
    const afterBurst = await notifsFor(alice.user_id);
    const batch = afterBurst.filter((n) => n.dedup_key.startsWith('feed-events:'));
    check('four events in one window produce ONE notification', afterBurst.length - beforeBurst, 1);
    check('  ...carrying the full count', batch[0].item_count, 4);
    check('  ...titled for the batch', batch[0].title, '4 new events');
    check('  ...pointing at the feed, not one event', batch[0].url, '/app/home');

    // A LONE item must keep its own identity and deep link — collapsing one thing into
    // "1 new event" pointing at the feed would be strictly worse than not batching at all.
    await S.IngestionState.destroy({ where: { key: 'notify:last_event_id' } });
    await S.Notification.destroy({ where: { user_id: [900001, 900002] } });
    await gen.generate();                                   // re-seed watermark, notify nothing
    const solo = await S.Event.create({
        name: `${TAG} solo event`, club_id: club.id,
        tentative_start_time: new Date(Date.now() + 86400000), duration_minutes: 60,
    });
    await gen.generate();
    const soloRow = (await notifsFor(alice.user_id)).find((n) => n.dedup_key.startsWith('feed-events:'));
    check('a single event keeps its own title', soloRow.title, 'New event');
    check('  ...and its deep link', soloRow.url, `/app/event/${solo.id}`);
    check('  ...with a count of one', soloRow.item_count, 1);

    // The bug this replaced: items arriving on a LATER tick inside the same window used to be
    // dropped, because emit() ignores a duplicate dedup_key and the watermark advanced anyway.
    await S.Event.create({
        name: `${TAG} later in the same window`, club_id: club.id,
        tentative_start_time: new Date(Date.now() + 86400000), duration_minutes: 60,
    });
    await gen.generate();
    const grown = (await notifsFor(alice.user_id)).find((n) => n.dedup_key.startsWith('feed-events:'));
    check('an item on a later tick JOINS the batch (was silently dropped)', grown.item_count, 2);
    check('  ...and the batch generalises', grown.title, '2 new events');

    await cleanup();
    await sequelize.close();
    console.log(`\n${pass}/${pass + fail} passed.`);
    process.exit(fail ? 1 : 0);
})().catch(async (e) => {
    console.error('ERROR:', e.message);
    try { await sequelize.close(); } catch { /* already closed */ }
    process.exit(1);
});
