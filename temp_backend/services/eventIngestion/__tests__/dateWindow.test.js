/**
 * The year-hallucination guard. A bare day+month that has already passed gets resolved forward to
 * NEXT year — normally the right call, but wrong when the email itself is late. The real case:
 * "MDG Talks 3.0 | Ep1 drops at 9PM 20th Aug", sent 22 Aug 2026, body saying "drops today, 20th
 * August". The model answered 2027-08-20, which sat inside the old 400-day window and was accepted.
 *
 * Ruling: a missing date beats a wrong one. A wrong date sends people somewhere on the wrong day;
 * a blank one gets filled in review.
 *
 * The forward edge is 200 days. Measured over a year of mail, only two legitimate dates sit more than
 * 90 days ahead (+95d World Landslide Forum, +151d Winter School) and nothing legitimate falls between
 * 181 and 400 days — so 200 keeps everything real and still catches a 365-day error.
 *
 * From temp_backend/: node services/eventIngestion/__tests__/dateWindow.test.js
 */
const { mergeFields } = require('./../index');

const SENT = '2026-08-22T12:13:00+05:30';                          // the real MDG email
const TEXT = 'Part 1 drops today, 20th August 2027 at 9:00 PM.';   // a year is present so the format gate passes

let pass = 0, fail = 0;
const t = (label, llmDate, want) => {
    const got = mergeFields({ startDate: null }, { date: llmDate }, TEXT, SENT).payload.startDate || null;
    if (got === want) { pass++; console.log(`✅ ${label}`); }
    else { fail++; console.log(`❌ ${label}\n     got  ${got}\n     want ${want}`); }
};

// the case that started this
t('a date a full year out is refused, leaving no date', '2027-08-20', null);

// both legitimate far-future events measured across a year of mail must survive
t('World Landslide Forum, +97 days', '2026-11-27', '2026-11-27');
t('International Winter School, +153 days', '2027-01-22', '2027-01-22');

// ordinary cases
t('next week', '2026-08-29', '2026-08-29');
t('tomorrow', '2026-08-23', '2026-08-23');
t('a fortnight ago is still allowed — late announcements happen', '2026-08-08', '2026-08-08');

// the boundary itself
t('just inside the window (+199d)', '2027-03-09', '2027-03-09');
t('just outside the window (+201d)', '2027-03-11', null);
t('far past, beyond -30d, is refused', '2026-01-01', null);

console.log(`\n${pass}/${pass + fail} passed.`);
if (fail) process.exit(1);
