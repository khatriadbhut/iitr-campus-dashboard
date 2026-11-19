const express = require('express');
const sequelize = require('../database/connection');
const { requireSuperAdmin } = require('../middlewares/permissions/superAdmin');

const router = express.Router();

/**
 * Admin analytics. SUPER-ADMIN ONLY.
 *
 * Gated on middlewares/permissions/superAdmin.js — the `user.is_super_admin` COLUMN, not a
 * permission row. This distinction is the whole point and it is easy to get wrong: an earlier draft
 * of this file gated on the `manage_club_admins` permission, which is itself grantable, so any club
 * admin handed that permission would have been able to read every user's activity and every logged
 * IP address. A permission cannot gate a page whose whole purpose is oversight of permission holders.
 *
 * The guard reads the column from the database on every request rather than from the JWT, so
 * demoting someone takes effect on their next call, not whenever their token happens to expire. It
 * also runs userData internally, which is what stamps presence — so these routes need no separate
 * auth middleware in front of them.
 *
 * A note on what this can and cannot tell you: provenance only exists from the moment the app
 * started recording it. Nothing published before utils/activityLog.js landed has an author, because
 * the publish path never stored one and `event` has no timestamp column at all. Those rows are gone,
 * not merely unqueried, and the UI says so rather than implying an empty list means nothing happened.
 */

const q = (sql, replacements) => sequelize.query(sql, { type: sequelize.QueryTypes.SELECT, replacements });

/**
 * "changed permissions" tells you nothing; "granted Manage Admins to Priya Nair" tells you what to do
 * about it. The audit row stores permission IDs because that is what the request carried, so the
 * names are resolved here rather than stored — a name copied into the log at write time would go
 * stale the day a permission is renamed, while the ID stays correct forever.
 *
 * The table has fewer than ten rows and changes approximately never, so it is cached for the life of
 * the process instead of joined per request.
 */
let permissionNames = null;
async function resolvePermissionNames(rows) {
    if (!rows.some((r) => Array.isArray(r.detail?.permission_ids))) return rows;
    if (!permissionNames) {
        try {
            const all = await q('SELECT id, name FROM admin_permission');
            permissionNames = new Map(all.map((p) => [Number(p.id), p.name]));
        } catch { return rows; }
    }
    return rows.map((r) => (Array.isArray(r.detail?.permission_ids)
        ? {
            ...r,
            detail: {
                ...r.detail,
                permission_names: r.detail.permission_ids
                    .map((id) => permissionNames.get(Number(id)))
                    .filter(Boolean),
            },
        }
        : r));
}

// ── GET /analytics/overview ─────────────────────────────────────────────────
router.get('/overview', requireSuperAdmin, async (req, res) => {
    try {
        const [live, users, content, notifications, topIps] = await Promise.all([
            // "Active now" = seen in the last 5 minutes. Presence is written at most once a minute
            // per user (middlewares/presence.js), so anything tighter than ~2 min would undercount.
            q(`SELECT
                 count(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '5 minutes')  AS now_5m,
                 count(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '1 hour')     AS last_hour,
                 count(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '24 hours')   AS last_day
               FROM "user"`),
            q(`SELECT count(*) AS total,
                      count(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Kolkata')::date
                                             = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS today
               FROM "user"`),
            q(`SELECT
                 (SELECT count(*) FROM event)  AS events,
                 (SELECT count(*) FROM notice) AS notices,
                 (SELECT count(*) FROM event_proposal WHERE state = 'proposed') AS pending_review,
                 (SELECT count(*) FROM user_todo) AS todos`),
            q(`SELECT count(*) AS total,
                      count(DISTINCT user_id) AS recipients,
                      (SELECT count(*) FROM push_subscription WHERE enabled) AS devices
               FROM notification`),
            // The addresses worth looking at. A single failed login is somebody mistyping; a burst
            // from one address is the thing you actually want surfaced without going hunting.
            q(`SELECT ip, count(*) AS n, max(created_at) AS last_seen
               FROM privilege_audit
               WHERE action IN ('login_failed','rate_limited','forbidden')
                 AND created_at > NOW() - INTERVAL '24 hours' AND ip IS NOT NULL
               GROUP BY ip ORDER BY n DESC LIMIT 8`),
        ]);
        res.json({
            live: live[0], users: users[0], content: content[0], notifications: notifications[0],
            topIps,
        });
    } catch (e) {
        console.error('analytics overview failed:', e);
        res.status(500).json({ error: 'Could not load analytics' });
    }
});

// ── The log stream ──────────────────────────────────────────────────────────
/**
 * One chronological stream, filtered — not three lists that have to be correlated by eye.
 *
 * The panel this replaces showed a fixed "last 12" per category, which is fine on day one and
 * useless by day ten: there is no way to reach older rows, no way to ask a question of them, and no
 * way to tell whether a quiet list means nothing happened or that the interesting thing scrolled off.
 *
 * KEYSET pagination (`before` = last id seen), not OFFSET. Rows arrive continuously, so an offset
 * page 2 taken a minute after page 1 would repeat rows that shifted down; an id cursor is stable no
 * matter what was inserted meanwhile. It also stays fast at any depth, where OFFSET degrades.
 *
 * `since` is the same query in the other direction and is what makes the view genuinely live: the
 * client passes the newest id it holds and gets only what is new, so tailing costs one small query
 * rather than re-fetching the page.
 */
const GROUPS = Object.freeze({
    content:  ['event_published', 'notice_published', 'notice_posted_manual', 'calendar_published', 'proposal_dismissed'],
    admin:    ['grant_admin', 'revoke_admin', 'update_admin', 'grant_club_admin', 'revoke_club_admin'],
    security: ['login_failed', 'rate_limited', 'forbidden', 'attack_attempt'],
});

/**
 * "Urgent" is a severity, not a category — that is the point of it. It cuts across the groups so a
 * password-spray (security) and someone being handed super admin (permissions) appear side by side,
 * which is how they would actually be investigated. Selected via `severity`, not `group`.
 */

/**
 * Build the WHERE clause shared by the stream and its counts.
 *
 * Every value is bound, never interpolated — `q` is a free-text box that reaches a SQL string, which
 * is precisely the shape that goes wrong. The one identifier-ish input, `group`, is checked against
 * GROUPS rather than substituted, so an unknown group yields no filter instead of injected SQL.
 */
function buildFilters(query) {
    const where = [];
    const repl = {};

    const group = String(query.group || 'all');
    // IN, not `= ANY(:actions)`. Sequelize expands an array replacement into a comma-separated list,
    // which ANY() cannot take — it wants an array literal — so the ANY form is a syntax error at
    // runtime for every group except "all", where the clause is skipped entirely.
    if (GROUPS[group]) { where.push('a.action IN (:actions)'); repl.actions = GROUPS[group]; }

    // Severity cuts ACROSS the groups rather than being one of them: a password spray (security) and
    // somebody being handed super admin (permissions) are investigated together, so they must be
    // selectable together. A literal, not a binding — the only accepted value is this one constant.
    if (query.severity === 'urgent') where.push("a.severity = 'urgent'");

    // Exact-action filtering, for narrowing to one kind ("only show who was made admin"). Intersected
    // with the known list so an arbitrary string can never reach the query.
    if (query.actions) {
        const known = new Set(Object.values(GROUPS).flat());
        const picked = String(query.actions).split(',').map((a) => a.trim()).filter((a) => known.has(a));
        if (picked.length) { where.push('a.action IN (:pickedActions)'); repl.pickedActions = picked; }
    }

    if (query.from) { where.push('a.created_at >= :from'); repl.from = new Date(query.from); }
    if (query.to)   { where.push('a.created_at <= :to');   repl.to   = new Date(query.to); }
    if (query.ip)   { where.push('a.ip = :ip');            repl.ip   = String(query.ip); }
    if (query.actor) { where.push('a.actor_user_id = :actor'); repl.actor = Number(query.actor); }

    // Free text spans the fields an admin actually searches by: a person, an address, a kind of
    // event, or a title buried in the detail blob. detail is cast to text so "Ken" finds the event
    // without needing to know which key holds it.
    const text = (query.q || '').trim();
    if (text) {
        where.push(`(
            u.full_name ILIKE :q OR u.enrolment_number ILIKE :q OR u.branch ILIKE :q
            OR a.ip ILIKE :q OR a.action ILIKE :q OR a.detail::text ILIKE :q
        )`);
        repl.q = `%${text}%`;
    }
    return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', repl };
}

const LOG_SELECT = `
    SELECT a.id, a.action, a.detail, a.ip, a.created_at, a.actor_user_id, a.severity,
           u.full_name, u.enrolment_number, u.branch, u.branch_department_name,
           t.full_name AS target_name, t.enrolment_number AS target_enrolment
    FROM privilege_audit a
    LEFT JOIN "user" u ON u.user_id = a.actor_user_id
    LEFT JOIN "user" t ON t.user_id = a.target_user_id`;

router.get('/logs', requireSuperAdmin, async (req, res) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
        const { clause, repl } = buildFilters(req.query);

        // Live tail: everything newer than what the client already has. Bounded like any other page,
        // so a long-backgrounded tab resumes with a bounded query rather than dragging back hours.
        if (req.query.since) {
            const rows = await q(
                `${LOG_SELECT} ${clause}${clause ? ' AND' : ' WHERE'} a.id > :since ORDER BY a.id DESC LIMIT :limit`,
                { ...repl, since: Number(req.query.since), limit },
            );
            return res.json({ rows: await resolvePermissionNames(rows), live: true });
        }

        // Fetch one extra row to learn whether another page exists, without a second COUNT.
        const before = req.query.before ? Number(req.query.before) : null;
        const rows = await q(
            `${LOG_SELECT} ${clause}${before ? `${clause ? ' AND' : ' WHERE'} a.id < :before` : ''}
             ORDER BY a.id DESC LIMIT :lookahead`,
            { ...repl, ...(before ? { before } : {}), lookahead: limit + 1 },
        );

        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        res.json({
            rows: await resolvePermissionNames(page),
            hasMore,
            nextCursor: page.length ? page[page.length - 1].id : null,
        });
    } catch (e) {
        console.error('analytics logs failed:', e);
        res.status(500).json({ error: 'Could not load logs' });
    }
});

/**
 * Counts per action for the current filters, so the group tabs can carry numbers.
 *
 * Deliberately ignores `group` (it counts every group under the same time/search filters) —
 * otherwise selecting "Security" would report zero for every other tab and the numbers would be
 * unusable for deciding where to look next.
 */
router.get('/logs/counts', requireSuperAdmin, async (req, res) => {
    try {
        const { clause, repl } = buildFilters({ ...req.query, group: 'all' });
        const [rows, urgent] = await Promise.all([
            q(`SELECT a.action, count(*) AS n
               FROM privilege_audit a
               LEFT JOIN "user" u ON u.user_id = a.actor_user_id
               ${clause}
               GROUP BY a.action`, repl),
            q(`SELECT count(*) AS n
               FROM privilege_audit a
               LEFT JOIN "user" u ON u.user_id = a.actor_user_id
               ${clause}${clause ? ' AND' : ' WHERE'} a.severity = 'urgent'`, repl),
        ]);

        const byAction = Object.fromEntries(rows.map((r) => [r.action, Number(r.n)]));
        const sum = (list) => list.reduce((t, k) => t + (byAction[k] || 0), 0);
        res.json({
            byAction,
            groups: {
                urgent: Number(urgent[0]?.n || 0),
                all: Object.values(byAction).reduce((t, n) => t + n, 0),
                content: sum(GROUPS.content),
                admin: sum(GROUPS.admin),
                security: sum(GROUPS.security),
            },
        });
    } catch (e) {
        console.error('analytics counts failed:', e);
        res.status(500).json({ error: 'Could not load counts' });
    }
});

// ── GET /analytics/content ──────────────────────────────────────────────────
// Where content came from and how long it took to arrive: the source email's timestamp against the
// notice's own. `event` has no created_at, so events can only report the email side.
router.get('/content', requireSuperAdmin, async (req, res) => {
    try {
        const [recentNotices, recentEvents, bySource] = await Promise.all([
            q(`SELECT n.id, n.title, n.priority, n.source, n.created_at, n.published_at,
                      c.name AS club_name,
                      e.internal_date AS email_arrived_at
               FROM notice n
               LEFT JOIN club c ON c.id = n.club_id
               LEFT JOIN ingested_email e ON e.message_id = n.source_message_id
               ORDER BY n.id DESC LIMIT 25`),
            q(`SELECT ev.id, ev.name, ev.source, ev.source_sender, ev.status,
                      ev.tentative_start_time, c.name AS club_name,
                      em.internal_date AS email_arrived_at
               FROM event ev
               LEFT JOIN club c ON c.id = ev.club_id
               LEFT JOIN ingested_email em ON em.message_id = ev.source_message_id
               ORDER BY ev.id DESC LIMIT 25`),
            q(`SELECT source, count(*) n FROM event GROUP BY source
               UNION ALL SELECT 'notice:' || COALESCE(source,'unknown'), count(*) FROM notice GROUP BY source`),
        ]);
        res.json({ recentNotices, recentEvents, bySource });
    } catch (e) {
        console.error('analytics content failed:', e);
        res.status(500).json({ error: 'Could not load content analytics' });
    }
});

module.exports = router;
