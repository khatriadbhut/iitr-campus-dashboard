/**
 * Deriving a notice's deadline from the academic calendar it points at.
 *
 *   node services/eventIngestion/__tests__/calendarDeadline.test.js
 *
 * The precedence being protected here is the whole point of the feature:
 *   a date the EMAIL states  >  a date the CALENDAR holds  >  no date
 * A derived date must never overwrite a stated one, and must always be marked as derived so a later
 * correction can replace it and a reader can tell the difference.
 *
 * Uses a fixed calendar fixture rather than the database, so it runs anywhere and cannot start
 * passing or failing because somebody re-imported a PDF.
 */
const { deadlineFromCalendar } = require('../calendarDeadline');

// A realistic slice: the right answer, plus the two entries that beat it on a naive word count.
const ENTRIES = [
    { semester: 'Autumn 2026-27', title: 'Last date for withdrawal of courses', start_date: '2026-10-05' },
    { semester: 'Autumn 2026-27', title: 'Re-examination and Second examination (for Autumn Semester)', start_date: '2027-01-11' },
    { semester: 'Autumn 2026-27', title: 'Academic registration of all existing students for Spring Semester', start_date: '2027-01-07' },
    { semester: 'Autumn 2026-27', title: 'Sangram 2026', start_date: '2026-10-03' },
    { semester: 'Spring 2025-26', title: 'Last date for withdrawal of courses', start_date: '2026-04-27' },
];

// Verbatim from the live "Option for 'Course Drop' on AIS portal." email.
const REAL_BODY = "Dear Students, It is informed that the 'Course Drop' option has been enabled on the AIS portal. "
    + 'Students are permitted to withdraw from a maximum of four (04) courses during the entire programme. '
    + 'Please refer to the Academic Calendar(Autumn Semester 2026-27) for last date for withdrawal of courses '
    + 'available on the link given below:';

let pass = 0, fail = 0;
const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n     got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`}`);
};
const derive = (title, body, deadline = null) => {
    const r = deadlineFromCalendar({ title, body, deadline }, ENTRIES);
    return r ? r.date : null;
};

console.log('── the case this exists for ──');
check('the real Course Drop email resolves to the calendar date',
    derive("Option for 'Course Drop' on AIS portal.", REAL_BODY), '2026-10-05');
check('and reports which entry it used',
    deadlineFromCalendar({ title: 'Course Drop', body: REAL_BODY, deadline: null }, ENTRIES).entry,
    'Last date for withdrawal of courses');

console.log('\n── precedence: a stated date always wins ──');
check('a notice that already has a deadline is never touched',
    derive('Course drop', REAL_BODY, '2026-09-20'), null);

console.log('\n── it refuses rather than guesses ──');
check('no reference to the calendar at all',
    derive('Library timings revised', 'The library will follow revised timings from next week.'), null);
check('refers to the calendar but names no semester',
    derive('Course drop', 'Please refer to the Academic Calendar for the last date for withdrawal of courses.'), null);
check('names a semester the calendar does not have',
    derive('Course drop', 'Refer to the Academic Calendar (Autumn Semester 2031-32) for last date for withdrawal of courses.'), null);
check('mentions a semester but never the calendar',
    derive('Autumn 2026-27 update', 'Withdrawal of courses is discussed at the next Senate meeting.'), null);
check('no entry covers enough of its own words',
    derive('Course drop', 'Refer to the Academic Calendar (Autumn Semester 2026-27) for the schedule.'), null);

console.log('\n── it picks the right semester, not just the right title ──');
check('Spring wording selects the Spring entry',
    derive('Course drop', 'Refer to the Academic Calendar (Spring Semester 2025-26) for last date for withdrawal of courses.'), '2026-04-27');

console.log('\n── phrasing variants seen in real mail ──');
check('"Autumn Semester 2026-27" (raw mail)',
    derive('Course drop', 'Refer to the Academic Calendar (Autumn Semester 2026-27) for last date for withdrawal of courses.'), '2026-10-05');
check('"Autumn 2026-27" (generated summary)',
    derive('Course Drop Option on AIS Portal',
        'You may withdraw from at most four courses across the whole programme. The last date for withdrawal is in the Autumn 2026-27 academic calendar.'),
    '2026-10-05');

console.log('\n── precedence when the two sources DISAGREE ──');
// These exercise noticePayload's conflict handling rather than the matcher alone, so they run the
// pipeline. The rule: the email's date is used (it is the more specific claim, and deferring to the
// calendar would undo genuine corrections), but the disagreement is surfaced instead of swallowed —
// UNLESS the mail says it is revising, which is the institute deliberately superseding the calendar.
{
    const { runPipeline } = require('../index');
    const CAL = 'Please refer to the Academic Calendar (Autumn Semester 2026-27) for last date for withdrawal of courses.';
    const run = (subject, body) => {
        const ps = runPipeline({ message_id: `<x-${body.length}@iitr.ac.in>`, from: 'Do Not Reply Acad <donotreply-acad@iitr.ac.in>', to: 'students-notices@iitr.ac.in', subject, body_text: body },
            { senderMap: {}, clubIndex: null, calendarEntries: ENTRIES });
        const n = (ps || []).find((p) => p.mutation_type === 'CREATE_NOTICE');
        return n ? { d: n.payload.deadline, src: n.payload.deadline_source, rc: (n.evidence && n.evidence.reason_codes) || [] } : null;
    };
    const conflicted = (r) => r.rc.some((x) => /^CONFLICT_CALENDAR_SAYS_/.test(x));

    const c = run('Course withdrawal — last date 20 September 2026', `The last date for withdrawal of courses is 20 September 2026. ${CAL}`);
    check('a conflicting email date is still the one used', c.d, '2026-09-20');
    check('and it is not labelled derived', c.src, null);
    check('and the disagreement is raised for review', conflicted(c), true);

    const r = run('REVISED: course withdrawal last date', `The last date for withdrawal of courses has been revised to 20 September 2026. ${CAL}`);
    check('a stated REVISION is not flagged as a conflict', conflicted(r), false);

    const a = run('Course withdrawal — last date 5 October 2026', `The last date for withdrawal of courses is 5 October 2026. ${CAL}`);
    check('agreement raises nothing', conflicted(a), false);
}

console.log('\n── the Groq-primary path must receive the calendar too ──');
// proposalForType() is the path taken whenever the LLM RECLASSIFIES an email, and it builds its notice
// payload through noticePayload(). It referenced calendarEntries without accepting it as a parameter,
// so every LLM-reclassified message threw "calendarEntries is not defined" — 27% of a live production
// backfill — while runPipeline's own path worked fine. Unit tests all passed because they exercise
// runPipeline, not this. Both calling shapes are pinned here.
{
    const { proposalForType } = require('../index');
    const email = {
        message_id: '<cal-groq@iitr.ac.in>',
        from: 'Do Not Reply Acad <donotreply-acad@iitr.ac.in>',
        to: 'students-notices@iitr.ac.in',
        subject: 'Course drop',
        body_text: 'Refer to the Academic Calendar (Autumn Semester 2026-27) for last date for withdrawal of courses.',
    };
    const withCal = proposalForType(email, 'info', 'registration', {}, null, null, ENTRIES);
    check('the LLM path derives the deadline when given the calendar', withCal.payload.deadline, '2026-10-05');
    check('and marks it derived', withCal.payload.deadline_source, 'calendar');

    // Called WITHOUT the argument it must still work — that is the shape that was throwing.
    let threw = null;
    try { proposalForType(email, 'info', 'registration', {}, null, null); } catch (e) { threw = e.message; }
    check('omitting calendarEntries does not throw', threw, null);
}

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail ? 1 : 0);
