/**
 * Turns state changes into `notification` rows. This is the whole of Phase 1: nothing here talks to
 * a push service — it fills the in-app centre and leaves rows with pushed_at IS NULL for the Phase 2
 * delivery worker to drain. That split is deliberate: this half carries no service-worker risk and
 * is useful on its own (an unread badge and a working list).
 *
 * Three channels, per the agreed design:
 *   mine   — todos due, and reminders on items the user belled
 *   feed   — newly published events/notices, EXCEPT from clubs the user muted
 *   review — new proposals, routed by reviewScope(), independent of feed preferences
 *
 * Every write goes through `emit()` and is deduplicated on (user_id, dedup_key) with
 * ON CONFLICT DO NOTHING, so re-running a tick is a no-op. That is what makes the worker safe to
 * restart, and it is the same lesson the ingestion pipeline learned the hard way.
 */
const { Op } = require('sequelize');
const sequelize = require('../../database/connection');
const { Notification, IngestionState, User } = require('../../database/schemas');
const { reviewScope } = require('../../utils/reviewScope');
const logger = require('../../utils/logger');

// Watermarks live in the existing generic key/value table rather than a near-duplicate of it. The
// table is NAMED for ingestion but is structurally a KV store (key, value, updated_at).
const WM_EVENT = 'notify:last_event_id';
const WM_NOTICE = 'notify:last_notice_id';
const WM_PROPOSAL = 'notify:last_proposal_id';

// Reminders and todos are found by time, not by id, so a worker that was down for a week must not
// wake up and fire a hundred stale alerts. Anything older than this is silently skipped — a reminder
// for a talk that finished yesterday is noise, not a notification.
const STALE_AFTER_HOURS = 12;

const IST = 'Asia/Kolkata';

/**
 * Read a watermark, INITIALISING it to the table's current maximum on first run.
 *
 * This is the single most important behaviour in the file. Without it, switching the feature on
 * would treat every event and notice ever published as "new" and blast the entire backlog at every
 * user at once — 9 events and 50 notices today, and far worse later. First run notifies nothing.
 */
async function watermark(key, table, column = 'id') {
    const row = await IngestionState.findByPk(key);
    if (row && row.value !== null && row.value !== '') return Number(row.value);
    const [[{ max }]] = await sequelize.query(`SELECT COALESCE(MAX(${column}), 0) AS max FROM ${table}`);
    await IngestionState.upsert({ key, value: String(max), updated_at: new Date() });
    logger.info({ key, seeded: Number(max) }, 'notification watermark seeded — backlog will not be notified');
    return Number(max);
}

const setWatermark = (key, value) => IngestionState.upsert({ key, value: String(value), updated_at: new Date() });

/** Insert notification rows, ignoring any that already exist for that (user, dedup_key). */
async function emit(rows) {
    if (!rows.length) return 0;
    const created = await Notification.bulkCreate(rows, { ignoreDuplicates: true });
    // bulkCreate with ignoreDuplicates returns the rows it attempted; count the ones that got an id.
    return created.filter((r) => r.id !== null && r.id !== undefined).length;
}

// How long items are gathered into one notification. Ten minutes is roughly how long an admin
// spends clearing a review queue, which is exactly the burst this exists to absorb.
const BATCH_WINDOW_MS = 10 * 60 * 1000;
const bucketKey = () => new Date(Math.floor(Date.now() / BATCH_WINDOW_MS) * BATCH_WINDOW_MS)
    .toISOString().slice(0, 16);

/**
 * Add one item to a user's batch for this window, creating the batch if it is the first.
 *
 * Why not just emit() with a bucket in the dedup key: emit() ignores conflicts, so the FIRST item in
 * a window created the row and every later one was silently discarded — the count stayed at 1 and
 * nobody was ever told about items 2..n. The watermark advanced regardless, so they were gone for
 * good. That was live in the review channel.
 *
 * A lone item keeps its own title and DEEP LINK ("New event — Annual Athletics Meet" -> that event),
 * because collapsing a single thing into "1 new event" pointing at the feed is strictly worse. The
 * generic form only appears once there are genuinely several.
 *
 * pushed_at is deliberately NOT reset when the count grows. A burst therefore produces at most one
 * buzz; the inbox still shows the accurate total. Re-pushing on every increment would recreate the
 * exact problem this is here to solve.
 */
async function addToBatch({ userId, channel, type, key, title, body, url, pluralUrl, pluralLabel }) {
    const dedup_key = `${key}:${bucketKey()}`;
    const [row, created] = await Notification.findOrCreate({
        where: { user_id: userId, dedup_key },
        defaults: { user_id: userId, channel, type, dedup_key, title, body, url, item_count: 1 },
    });
    if (created) return 1;

    const next = row.item_count + 1;
    await row.update({
        item_count: next,
        title: `${next} ${pluralLabel}`,
        body: null,
        url: pluralUrl,
    });
    return 0;                  // an existing batch grew; no NEW notification was raised
}

// ── Channel: mine ────────────────────────────────────────────────────────────

/** Reminders whose time has arrived, for users who still want saved-item alerts. */
async function dueReminders() {
    const rows = await sequelize.query(`
        SELECT r.event_id, r.user_id, r.offset_minutes, e.name, e.tentative_start_time
        FROM reminder r
        JOIN event e ON e.id = r.event_id
        LEFT JOIN user_notification_pref p ON p.user_id = r.user_id
        WHERE r.reminder_time <= NOW()
          AND r.reminder_time > NOW() - INTERVAL '${STALE_AFTER_HOURS} hours'
          AND e.status <> 'cancelled'
          AND COALESCE(p.saved_items, TRUE) = TRUE
    `, { type: sequelize.QueryTypes.SELECT });

    return emit(rows.map((r) => ({
        user_id: r.user_id,
        channel: 'mine',
        type: 'reminder',
        // Offset is part of the key: a 30-minute and a 5-minute reminder for the same event are two
        // separate notifications, not a duplicate.
        dedup_key: `reminder:${r.event_id}:${r.offset_minutes}`,
        url: `/app/event/${r.event_id}`,
        title: r.name,
        body: r.offset_minutes >= 60
            ? `Starts in ${Math.round(r.offset_minutes / 60)} hour${r.offset_minutes >= 120 ? 's' : ''}`
            : `Starts in ${r.offset_minutes} minutes`,
    })));
}

/**
 * Todos at their due time. No lead time, by product decision — it fires at due_time exactly.
 *
 * due_date is a DATE and due_time an "HH:MM" string, both wall-clock IST. They are combined and
 * anchored to Asia/Kolkata rather than compared naively, or the whole feature would be 5.5 hours off.
 * A todo with a date but no time is treated as 09:00, not midnight — a midnight alert for "submit
 * the form today" is useless.
 */
async function dueTodos() {
    const rows = await sequelize.query(`
        SELECT t.id, t.user_id, t.text
        FROM user_todo t
        LEFT JOIN user_notification_pref p ON p.user_id = t.user_id
        WHERE t.completed = FALSE
          AND t.due_date IS NOT NULL
          AND ((t.due_date::timestamp + COALESCE(NULLIF(t.due_time, ''), '09:00')::time) AT TIME ZONE :tz) <= NOW()
          AND ((t.due_date::timestamp + COALESCE(NULLIF(t.due_time, ''), '09:00')::time) AT TIME ZONE :tz)
              > NOW() - INTERVAL '${STALE_AFTER_HOURS} hours'
          AND COALESCE(p.todos, TRUE) = TRUE
    `, { type: sequelize.QueryTypes.SELECT, replacements: { tz: IST } });

    return emit(rows.map((t) => ({
        user_id: t.user_id,
        channel: 'mine',
        type: 'todo',
        dedup_key: `todo:${t.id}`,
        url: '/app/todo',
        title: 'Todo due',
        body: t.text,
    })));
}

/**
 * The same, for notices. Kept as its own query rather than a UNION because notice_reminder is a
 * separate table (see database/schemas/noticeReminder.js for why) and the joined columns differ —
 * a notice has a `title`, an event has a `name`.
 *
 * A notice reminder points at a DEADLINE far more often than a start time, so the wording differs
 * too: "Closes in 30 minutes" reads correctly for an apply-by, "Starts in" would not.
 */
async function dueNoticeReminders() {
    const rows = await sequelize.query(`
        SELECT r.notice_id, r.user_id, r.offset_minutes, n.title, n.deadline
        FROM notice_reminder r
        JOIN notice n ON n.id = r.notice_id
        LEFT JOIN user_notification_pref p ON p.user_id = r.user_id
        WHERE r.reminder_time <= NOW()
          AND r.reminder_time > NOW() - INTERVAL '${STALE_AFTER_HOURS} hours'
          AND COALESCE(p.saved_items, TRUE) = TRUE
    `, { type: sequelize.QueryTypes.SELECT });

    return emit(rows.map((r) => {
        const unit = r.offset_minutes >= 60
            ? `${Math.round(r.offset_minutes / 60)} hour${r.offset_minutes >= 120 ? 's' : ''}`
            : `${r.offset_minutes} minutes`;
        return {
            user_id: r.user_id,
            channel: 'mine',
            type: 'reminder',
            dedup_key: `notice-reminder:${r.notice_id}:${r.offset_minutes}`,
            url: `/app/notices/${r.notice_id}`,
            title: r.title,
            body: r.deadline ? `Closes in ${unit}` : `In ${unit}`,
        };
    }));
}

// ── Channel: feed ────────────────────────────────────────────────────────────

/**
 * Everyone who wants feed alerts and has NOT muted this club.
 *
 * Note there is no "clubs I follow" whitelist anywhere in this app — only the mute half was ever
 * built (see src/pages/Home.jsx:354). So this is everything-minus-mutes, which is exactly what the
 * settings copy promises. A LEFT JOIN with COALESCE covers users who have never opened settings and
 * therefore have no preference row.
 */
async function feedAudience(clubId, { noticePriority = null } = {}) {
    // noticePriority describes the NOTICE, and the gate it produces describes the USER's setting —
    // keeping those two straight matters, because naming this after the user's preference is exactly
    // how it got inverted the first time (a general notice was delivered to "important only" users).
    //
    //   important notice -> users on 'important' OR 'all'
    //   general notice   -> users on 'all' only
    //   'off'            -> never, in either case
    //   an EVENT         -> no notice gate at all
    let noticeGate = '';
    if (noticePriority === 'important') {
        noticeGate = `AND COALESCE(p.campus_notices, 'important') IN ('important', 'all')`;
    } else if (noticePriority) {
        noticeGate = `AND COALESCE(p.campus_notices, 'important') = 'all'`;
    }
    return sequelize.query(`
        SELECT u.user_id
        FROM "user" u
        LEFT JOIN user_notification_pref p ON p.user_id = u.user_id
        WHERE COALESCE(p.campus_feed, TRUE) = TRUE
          ${noticeGate}
          AND NOT EXISTS (
              SELECT 1 FROM user_not_preferred_club n
              WHERE n.user_id = u.user_id AND n.club_id = :clubId
          )
    `, { type: sequelize.QueryTypes.SELECT, replacements: { clubId: clubId ?? -1 } });
}

/** Newly published events, fanned out to the feed audience. */
async function newEvents() {
    const since = await watermark(WM_EVENT, 'event');
    const events = await sequelize.query(`
        SELECT id, name, club_id FROM event
        WHERE id > :since AND status <> 'cancelled'
        ORDER BY id ASC LIMIT 200
    `, { type: sequelize.QueryTypes.SELECT, replacements: { since } });
    if (!events.length) return 0;

    let n = 0;
    for (const e of events) {
        const audience = await feedAudience(e.club_id);
        for (const u of audience) {
            n += await addToBatch({
                userId: u.user_id, channel: 'feed', type: 'event', key: 'feed-events',
                title: 'New event', body: e.name, url: `/app/event/${e.id}`,
                pluralUrl: '/app/home', pluralLabel: 'new events',
            });
        }
    }
    await setWatermark(WM_EVENT, events[events.length - 1].id);
    return n;
}

/**
 * Newly published notices. Respects the three-way preference: off / important only / all.
 * "Important" is the consequence-based band the ingestion pipeline already computes — a fee deadline
 * is important, a routine circular is not — so this reuses existing judgement rather than inventing a
 * second definition of urgency.
 */
async function newNotices() {
    const since = await watermark(WM_NOTICE, 'notice');
    const notices = await sequelize.query(`
        SELECT id, title, club_id, priority FROM notice
        WHERE id > :since AND published_at IS NOT NULL
        ORDER BY id ASC LIMIT 200
    `, { type: sequelize.QueryTypes.SELECT, replacements: { since } });
    if (!notices.length) return 0;

    let n = 0;
    for (const notice of notices) {
        const important = notice.priority === 'important';
        // A general notice reaches only users who asked for ALL notices; an important one reaches
        // both bands. Users set to 'off' are excluded by the audience query either way.
        const audience = await feedAudience(notice.club_id, { noticePriority: important ? 'important' : 'general' });
        for (const u of audience) {
            n += await addToBatch({
                userId: u.user_id, channel: 'feed', type: 'notice', key: 'feed-notices',
                title: important ? 'Important notice' : 'New notice', body: notice.title,
                url: `/app/notices/${notice.id}`,
                pluralUrl: '/app/home?tab=notices', pluralLabel: 'new notices',
            });
        }
    }
    await setWatermark(WM_NOTICE, notices[notices.length - 1].id);
    return n;
}

// ── Channel: review ──────────────────────────────────────────────────────────

/**
 * New proposals, COALESCED into one notification per 10-minute window per admin.
 *
 * Coalescing is not a nicety. A backfill on 2026-08-26 created 38 proposals in nine minutes; one
 * notification each would have been 38 buzzes for two people, which is how notifications get turned
 * off permanently. The window is part of the dedup key, so a second tick inside the same window
 * updates nothing and emits nothing.
 */
async function newReviewItems() {
    const since = await watermark(WM_PROPOSAL, 'event_proposal');
    const proposals = await sequelize.query(`
        SELECT id, club_id FROM event_proposal
        WHERE id > :since AND state = 'proposed'
        ORDER BY id ASC LIMIT 500
    `, { type: sequelize.QueryTypes.SELECT, replacements: { since } });
    if (!proposals.length) return 0;

    // Candidate reviewers: anyone who administers a club, plus anyone with a global permission.
    const candidates = await sequelize.query(`
        SELECT DISTINCT u.user_id
        FROM "user" u
        LEFT JOIN user_notification_pref p ON p.user_id = u.user_id
        WHERE COALESCE(p.review_queue, TRUE) = TRUE
          AND (EXISTS (SELECT 1 FROM club_admin ca WHERE ca.user_id = u.user_id)
            OR EXISTS (SELECT 1 FROM admin_permission_alloted a WHERE a.user_id = u.user_id))
    `, { type: sequelize.QueryTypes.SELECT });

    let n = 0;
    for (const c of candidates) {
        const scope = await reviewScope(c.user_id);
        const mine = scope.all
            ? proposals
            : proposals.filter((p) => scope.clubIds.includes(Number(p.club_id)));
        if (!mine.length) continue;
        // Accumulate into this window's batch rather than emit()ing a fresh row. With emit() the
        // first tick in a window created "3 new items" and every later tick was dropped as a
        // duplicate — so proposals arriving 4..n minutes later were never mentioned to anyone, while
        // the watermark advanced past them regardless.
        for (let i = 0; i < mine.length; i++) {
            n += await addToBatch({
                userId: c.user_id, channel: 'review', type: 'review', key: 'review',
                title: '1 new item to review', body: 'Email review queue',
                url: '/app/admin?tab=email-review',
                pluralUrl: '/app/admin?tab=email-review', pluralLabel: 'new items to review',
            });
        }
    }

    await setWatermark(WM_PROPOSAL, proposals[proposals.length - 1].id);
    return n;
}

// ── Entry point ──────────────────────────────────────────────────────────────

async function generate() {
    const out = { reminders: 0, noticeReminders: 0, todos: 0, events: 0, notices: 0, review: 0 };
    // Each source is independent: one that throws must not stop the others, or a single bad row in
    // the feed would silently cost every user their todo reminders too.
    const run = async (name, fn) => {
        try { out[name] = await fn(); }
        catch (e) { logger.error({ err: e, source: name }, 'notification source failed'); }
    };
    await run('reminders', dueReminders);
    await run('noticeReminders', dueNoticeReminders);
    await run('todos', dueTodos);
    await run('events', newEvents);
    await run('notices', newNotices);
    await run('review', newReviewItems);
    return out;
}

module.exports = { generate, dueReminders, dueNoticeReminders, dueTodos, newEvents, newNotices, newReviewItems, watermark };
