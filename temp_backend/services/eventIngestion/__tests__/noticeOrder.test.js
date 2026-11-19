/**
 * Ordering of the Notices feed. Every case here is a real row shape observed in prod on 2026-08-22,
 * when the first TWELVE notices served were all expired.
 * Run: node services/eventIngestion/__tests__/noticeOrder.test.js
 */
const { isExpired, compareNotices, istToday } = require('../../../utils/noticeOrder');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};

const TODAY = '2026-08-22';
const n = (title, deadline, priority = 'general', extra = {}) => ({ title, deadline, priority, published_at: '2026-08-01', ...extra });

// ── expiry ──
ok('a past deadline is expired', isExpired(n('x', '2026-07-15'), TODAY));
ok('today is NOT expired', !isExpired(n('x', TODAY), TODAY));
ok('a future deadline is not expired', !isExpired(n('x', '2026-09-11'), TODAY));
ok('no deadline is never expired', !isExpired(n('x', null), TODAY));
ok('open_ended never expires', !isExpired(n('x', '2026-01-01', 'general', { open_ended: true }), TODAY));
// DATEONLY means end of day IST; comparing in UTC would expire everything 5.5h early
ok('IST date is used, not UTC', istToday(Date.parse('2026-08-22T19:00:00Z')) === '2026-08-23');

// ── ordering ──
const feed = [
    n('Final extension Tuition Fee Waiver', '2026-07-15', 'important'),
    n('NSS Recruitment', '2026-07-31', 'important'),
    n('Rashtriya Ekta Diwas Tableaux', '2026-08-21', 'important'),
    n('NCC Cadet Registration', '2026-08-22', 'important'),
    n('Tuition Fee Waiver first-year', '2026-09-11', 'important'),
    n('MITACS internship', '2026-09-16', 'general'),
    n('Wellness Centre resources', null, 'general'),
].sort((a, b) => compareNotices(a, b, TODAY));

ok('an actionable item is first, not a corpse', feed[0].title === 'NCC Cadet Registration',
    `got ${feed[0].title}`);
ok('no expired item appears before a live one',
    feed.findIndex((x) => isExpired(x, TODAY)) > feed.map((x) => isExpired(x, TODAY)).lastIndexOf(false),
    feed.map((x) => `${isExpired(x, TODAY) ? 'X' : '.'}${x.title}`).join(' | '));
ok('live important outranks live general',
    feed.indexOf(feed.find((x) => x.title === 'Tuition Fee Waiver first-year'))
    < feed.indexOf(feed.find((x) => x.title === 'MITACS internship')));
// ── NEWEST FIRST among live items ──────────────────────────────────────────────────────────────
// The rule used to be "soonest deadline first", which made the tab nearly static: the same
// closing-soon items camped at the top while new notices arrived underneath. Urgency is carried by
// the pinned band, the deadline chip and the closing-soon filters; sort order carries chronology.
//
// NB the fixture above deliberately gives every row the same published_at, so it can say nothing
// about recency — these cases set real dates.
{
    const at = (title, published_at, deadline = null, priority = 'general') =>
        ({ title, deadline, priority, published_at });
    const live = [
        at('arrived first',  '2026-08-10', '2026-09-30'),
        at('arrived last',   '2026-08-25', '2026-12-31'),   // furthest deadline, newest arrival
        at('arrived middle', '2026-08-18', null),           // no deadline at all
    ].sort((a, b) => compareNotices(a, b, TODAY));
    ok('newest arrival comes first, even with the furthest deadline',
        live[0].title === 'arrived last', `got ${live[0].title}`);
    ok('a dateless notice takes its place by arrival, not last',
        live[1].title === 'arrived middle', `got ${live[1].title}`);
    ok('oldest arrival is last', live[2].title === 'arrived first', `got ${live[2].title}`);

    // The pinned band still wins over recency — importance is a stronger claim than newness.
    const banded = [
        at('new but general',   '2026-08-26', '2026-09-30', 'general'),
        at('older but pinned',  '2026-08-05', '2026-09-30', 'important'),
    ].sort((a, b) => compareNotices(a, b, TODAY));
    ok('IMPORTANT still outranks a newer general notice',
        banded[0].title === 'older but pinned', `got ${banded[0].title}`);
}
ok('most recently expired comes first within the expired band',
    feed.filter((x) => isExpired(x, TODAY))[0].title === 'Rashtriya Ekta Diwas Tableaux',
    feed.filter((x) => isExpired(x, TODAY)).map((x) => x.title).join(' | '));
ok('nothing is dropped — sorting, not filtering', feed.length === 7);

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail ? 1 : 0);
