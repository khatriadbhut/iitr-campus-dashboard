/**
 * The log stream: filters, keyset paging and the live cursor.
 *
 * These are the behaviours that only matter once the table is big — exactly when they stop being
 * testable by eye — so they are pinned here instead.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')) {
    console.error('REFUSING TO RUN: DATABASE_URL is not local'); process.exit(1);
}
const jwt = require('jsonwebtoken');
const { User, PrivilegeAudit, sequelize } = require('../database/schemas');

const BASE = 'http://localhost:8081';
const ID = 900911;
const IP = '198.51.100.77';                       // TEST-NET-2, never a real client
let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log(`  ok  ${n}`)) : (fail++, console.log(`  FAIL ${n}`)); };

(async () => {
  let token;
  try {
    await User.destroy({ where: { user_id: ID } });
    const u = await User.create({
        user_id: ID, full_name: 'Log Fixture', enrolment_number: 'LOG900911',
        email: 'log900911@example.invalid', branch: 'CSE', is_super_admin: true, token_version: 0,
    });
    token = jwt.sign({ user_id: ID, id: ID, tv: 0 }, process.env.JWT_SECRET, { expiresIn: '10m' });

    // 8 rows now, 1 row 20 days back — enough to page and to fall outside a 7d window.
    const mk = (i, daysAgo, action) => ({
        action, actor_user_id: ID, ip: IP,
        detail: { title: `Fixture Row ${i}`, marker: 'logtest' },
        created_at: new Date(Date.now() - daysAgo * 864e5 - i * 1000),
    });
    const fresh = [];
    for (let i = 0; i < 8; i++) fresh.push(mk(i, 0, i % 2 ? 'event_published' : 'login_failed'));
    fresh.push(mk(99, 20, 'event_published'));
    await PrivilegeAudit.bulkCreate(fresh);

    const get = async (path) => {
        const r = await fetch(`${BASE}${path}`, { headers: { Cookie: `auth_token=${token}` } });
        return { status: r.status, body: await r.json() };
    };

    // ── Filtering ──────────────────────────────────────────────────────────
    const mine = await get(`/analytics/logs?ip=${IP}&group=all&limit=200`);
    check('ip filter returns only that address', mine.body.rows.every((r) => r.ip === IP));
    check('ip filter found the fixtures', mine.body.rows.length >= 9);

    const sec = await get(`/analytics/logs?ip=${IP}&group=security&limit=200`);
    check('security group excludes publishes',
        sec.body.rows.length > 0 && sec.body.rows.every((r) => ['login_failed', 'rate_limited', 'forbidden'].includes(r.action)));

    const text = await get(`/analytics/logs?q=Fixture%20Row&limit=200`);
    check('free-text search reaches inside detail JSON', text.body.rows.length >= 9);

    const byName = await get(`/analytics/logs?q=LOG900911&limit=200`);
    check('search matches on enrolment number', byName.body.rows.length >= 9);

    // A date window must actually exclude. The 20-day-old row is the control.
    const week = await get(`/analytics/logs?ip=${IP}&from=${new Date(Date.now() - 7 * 864e5).toISOString()}&limit=200`);
    check('7-day window excludes the 20-day-old row',
        week.body.rows.length === mine.body.rows.length - 1);

    // ── Severity and exact-action filters ──────────────────────────────────
    // Both were silently absent once: the edit that added them matched nothing and str.replace does
    // not complain, so the endpoint kept returning everything while the UI showed an "Urgent" tab.
    await PrivilegeAudit.create({ action: 'attack_attempt', severity: 'urgent', ip: IP,
        detail: { kind: 'sql_injection', marker: 'logtest' }, created_at: new Date() });
    const urgentOnly = await get(`/analytics/logs?ip=${IP}&severity=urgent&limit=200`);
    check('severity=urgent returns ONLY urgent rows',
        urgentOnly.body.rows.length > 0 && urgentOnly.body.rows.every((r) => r.severity === 'urgent'));
    check('severity=urgent excludes rows that have no severity',
        urgentOnly.body.rows.length < mine.body.rows.length);

    const onlyPublishes = await get(`/analytics/logs?ip=${IP}&actions=event_published&limit=200`);
    check('actions= narrows to exactly that action',
        onlyPublishes.body.rows.length > 0 && onlyPublishes.body.rows.every((r) => r.action === 'event_published'));
    const twoActions = await get(`/analytics/logs?ip=${IP}&actions=event_published,login_failed&limit=200`);
    check('actions= accepts several', new Set(twoActions.body.rows.map((r) => r.action)).size === 2);
    const bogus = await get(`/analytics/logs?ip=${IP}&actions=${encodeURIComponent("'; DROP TABLE x; --")}&limit=200`);
    check('an unknown action name is dropped, not interpolated',
        bogus.status === 200 && bogus.body.rows.length === mine.body.rows.length + 1);

    // ── Keyset paging ──────────────────────────────────────────────────────
    const p1 = await get(`/analytics/logs?ip=${IP}&limit=4`);
    check('first page respects the limit', p1.body.rows.length === 4);
    check('first page reports more to come', p1.body.hasMore === true);
    const p2 = await get(`/analytics/logs?ip=${IP}&limit=4&before=${p1.body.nextCursor}`);
    const overlap = p1.body.rows.filter((a) => p2.body.rows.some((b) => String(b.id) === String(a.id)));
    check('second page does not repeat the first', overlap.length === 0);
    check('pages are strictly descending',
        Number(p2.body.rows[0].id) < Number(p1.body.rows[p1.body.rows.length - 1].id));

    // ── Live cursor ────────────────────────────────────────────────────────
    const newestBefore = p1.body.rows[0].id;
    const quiet = await get(`/analytics/logs?ip=${IP}&since=${newestBefore}`);
    check('since returns nothing when nothing is new', quiet.body.rows.length === 0);

    await PrivilegeAudit.create({
        action: 'rate_limited', actor_user_id: null, ip: IP,
        detail: { marker: 'logtest', reason: 'arrived after the page load' }, created_at: new Date(),
    });
    const tail = await get(`/analytics/logs?ip=${IP}&since=${newestBefore}`);
    check('since picks up exactly the new row', tail.body.rows.length === 1);
    check('the new row is the one just written', tail.body.rows[0].detail.reason === 'arrived after the page load');

    // ── Counts ─────────────────────────────────────────────────────────────
    const c = await get(`/analytics/logs/counts?ip=${IP}`);
    check('counts add up to the group total',
        c.body.groups.content + c.body.groups.admin + c.body.groups.security === c.body.groups.all);
    check('counts ignore the selected group so every tab shows a number',
        (await get(`/analytics/logs/counts?ip=${IP}&group=security`)).body.groups.all === c.body.groups.all);

    // ── Injection ──────────────────────────────────────────────────────────
    // Searching for an injection string must SEARCH for it, not run it. Any rows that come back are
    // audit rows in which the detector recorded that literal as an attack sample — which is itself
    // the proof: the string reached the database as a value and came back as text.
    const evil = await get(`/analytics/logs?q=${encodeURIComponent("' OR 1=1 --")}&limit=5`);
    check('a quote in the search box is data, not SQL',
        evil.status === 200 && evil.body.rows.every((r) => JSON.stringify(r.detail || {}).includes('1=1')));
    const badGroup = await get('/analytics/logs?group=' + encodeURIComponent("x'); DROP TABLE privilege_audit; --"));
    check('an unknown group is ignored rather than interpolated', badGroup.status === 200);
    check('the table is still there afterwards', (await PrivilegeAudit.count()) > 0);
  } finally {
    await PrivilegeAudit.destroy({ where: { ip: IP } });
    await User.destroy({ where: { user_id: ID } });
    await sequelize.close();
  }
  console.log(`\n${pass}/${pass + fail} passed.`);
  process.exit(fail ? 1 : 0);
})();
