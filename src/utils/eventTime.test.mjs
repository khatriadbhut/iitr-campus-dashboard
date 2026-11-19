/**
 * The single definition of when an event starts and ends.
 *
 *   node src/utils/eventTime.test.mjs
 *
 * Every case here is a shape that actually reached a filter and was got wrong by at least one of the
 * three inline copies this file replaced.
 */
import { eventStartMs, eventEndMs, isEventLive, isEventOnFeed, eventOverlaps, durationLabel } from './eventTime.js';

let pass = 0, fail = 0;
const check = (name, got, want) => {
    const ok = got === want;
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n     got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`}`);
};
const at = (s) => new Date(s).getTime();

console.log('── a database event: start + duration ──');
const workshop = { tentative_start_time: '2026-09-10T18:00:00', duration_minutes: 180 };
check('ends three hours after it starts', eventEndMs(workshop), at('2026-09-10T21:00:00'));
check('live during it', isEventLive(workshop, 0, at('2026-09-10T19:00:00')), true);
check('over afterwards', isEventLive(workshop, 0, at('2026-09-10T21:00:01')), false);
check('the one-hour grace keeps it just after', isEventLive(workshop, 3600e3, at('2026-09-10T21:30:00')), true);

console.log('\n── an academic calendar row: explicit end, NO duration ──');
// This is the shape that kept breaking. duration_minutes is absent, so start+duration returns the
// start and a ten-day exam period looks like a zero-length one.
const exams = { isAcademicCalendar: true, tentative_start_time: '2026-09-10T00:00:00', tentative_end_time: '2026-09-19T23:59:59' };
check('honours the explicit end', eventEndMs(exams), at('2026-09-19T23:59:59'));
check('visible in the middle of the period', isEventLive(exams, 0, at('2026-09-15T12:00:00')), true);
check('gone after the last day', isEventLive(exams, 0, at('2026-09-20T00:00:01')), false);

console.log('\n── the calendar page shape: raw_start / raw_end date strings ──');
const fest = { isAcademicCalendar: true, raw_start: '2026-10-09', raw_end: '2026-10-12' };
check('a bare end date means the END of that day', eventEndMs(fest), at('2026-10-12T23:59:59'));
check('still visible on the final day', isEventLive(fest, 0, at('2026-10-12T20:00:00')), true);
// A bare date parsed as UTC midnight lands on the previous day west of UTC — the event would vanish
// a day early for anyone travelling. Parsed as local midnight it does not.
check('a bare start date is LOCAL midnight, not UTC', eventStartMs(fest), at('2026-10-09T00:00:00'));

console.log('\n── an event with no duration recorded ──');
const bare = { tentative_start_time: '2026-09-10T18:00:00' };
check('ends when it starts', eventEndMs(bare), at('2026-09-10T18:00:00'));
check('not hidden while it is happening', isEventLive(bare, 3600e3, at('2026-09-10T18:30:00')), true);

console.log('\n── window overlap, which is what a date filter wants ──');
const week = [at('2026-09-14T00:00:00'), at('2026-09-21T00:00:00')];
check('an exam period spanning the window is IN it', eventOverlaps(exams, week[0], week[1]), true);
check('a workshop before the window is out', eventOverlaps(workshop, week[0], week[1]), false);
check('a fest after the window is out', eventOverlaps(fest, week[0], week[1]), false);

console.log('\n── never hide something we cannot date ──');
check('no start at all → kept', eventOverlaps({}, week[0], week[1]), true);
check('unparseable end → kept', isEventLive({ tentative_start_time: 'nonsense' }, 0, Date.now()), true);


// ── isEventOnFeed: an event stays until the end of the DAY it ended on ───────────────────────────
{
    // A fixed "now": 26 Aug 2026, 6:00 PM local.
    const now = new Date(2026, 7, 26, 18, 0, 0).getTime();
    const at = (y, m, d, hh, mm, dur = 0) => ({
        tentative_start_time: new Date(y, m, d, hh, mm).toISOString(),
        duration_minutes: dur,
    });

    // THE CASE THIS EXISTS FOR: a 10am event, checked at 6pm the same day.
    check('an event that ended this MORNING is still on the feed',
        isEventOnFeed(at(2026, 7, 26, 10, 0, 60), now), true);
    check('and the old 1-hour rule would have dropped it',
        isEventLive(at(2026, 7, 26, 10, 0, 60), 3600 * 1000, now), false);

    check('an event still running is kept',
        isEventOnFeed(at(2026, 7, 26, 17, 30, 120), now), true);
    check('an event later today is kept',
        isEventOnFeed(at(2026, 7, 26, 21, 0, 60), now), true);
    check('an event tomorrow is kept',
        isEventOnFeed(at(2026, 7, 27, 9, 0, 60), now), true);

    check('YESTERDAY drops off',
        isEventOnFeed(at(2026, 7, 25, 18, 0, 60), now), false);
    check('a multi-day event that ends today is kept',
        isEventOnFeed(at(2026, 7, 24, 0, 0, 2 * 1440 + 1439), now), true);
    check('a multi-day event that ended yesterday drops off',
        isEventOnFeed(at(2026, 7, 23, 0, 0, 1440), now), false);

    // Midnight boundary: at 00:05, yesterday's evening event must already be gone.
    const justAfterMidnight = new Date(2026, 7, 26, 0, 5, 0).getTime();
    check('at 00:05, last night’s event is gone',
        isEventOnFeed(at(2026, 7, 25, 20, 0, 60), justAfterMidnight), false);
    check('at 00:05, an event later that same day is kept',
        isEventOnFeed(at(2026, 7, 26, 9, 0, 60), justAfterMidnight), true);

    check('an undated event is never hidden',
        isEventOnFeed({ tentative_start_time: null }, now), true);
}


// ── durationLabel: a multi-day span reads in DAYS, not 71h 59m ───────────────────────────────────
check('a 3-day trek (stored 00:00 -> 23:59) reads as 3 Days', durationLabel(4319), '3 Days');
check('a 2-day span reads as 2 Days', durationLabel(2880), '2 Days');
check('exactly one day is singular', durationLabel(1440), '1 Day');
check('under a day still reads in hours', durationLabel(105), '1h 45m');
check('a whole number of hours', durationLabel(120), '2 Hours');
check('one hour is singular', durationLabel(60), '1 Hour');
check('under an hour reads in minutes', durationLabel(45), '45 Mins');
check('no duration yields nothing', durationLabel(0), '');
check('the detail page suffix', durationLabel(4319, 'Duration'), '3 Days Duration');
check('the suffix applies to hours too', durationLabel(105, 'Duration'), '1h 45m Duration');

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail ? 1 : 0);
