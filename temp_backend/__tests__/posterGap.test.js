/**
 * The poster catch-22.
 *
 * An office sends "please find attached invitation" with the date, time and venue only on the poster.
 * The old rule read a poster only for a proposal that was ALREADY a club event, so the poster went
 * unread because the mail looked empty, and the mail looked empty because the poster went unread —
 * and a real Janmashtami invitation from the Institute Computer Centre was discarded on the strength
 * of a covering note.
 *
 * These assert the two halves of the fix without touching Gmail or Gemini: the trigger is the GAP
 * rather than the category, and what the poster says goes back into the TEXT so the whole pipeline
 * re-judges the mail.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runPipeline } = require('../services/eventIngestion');
const { posterBlock } = require('../services/eventIngestion/runner');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log(`  ok  ${n}`)) : (fail++, console.log(`  FAIL ${n}`)); };

// The real thing, verbatim from production (ingested_email #1141).
const COVERING_NOTE = `Dear All,

I am sending this invitation on behalf of Prof. Nagendra Kumar.

Thanks,
Pradumn

Sincerely,
Head, Institute Computer Centre (ICC)
Indian Institute of Technology Roorkee
Email: head.icc@iitr.ac.in`;

const baseEmail = () => ({
    message_id: '<poster-test@iitr.ac.in>',
    gmail_id: 'test-gmail-id',
    thread_id: 't1',
    from: 'Head ICC <head.icc@iitr.ac.in>',
    to: 'students-notices@iitr.ac.in',   // a real broadcast list, or gate1 drops it before extraction
    cc: '',
    subject: 'Janmashtami Invite',
    body_text: COVERING_NOTE,
    internal_date: new Date('2026-09-01T09:08:00+05:30'),
});

const opts = { senderMap: {}, clubIndex: null, calendarEntries: [] };

// ── Before: the covering note alone carries no schedule ────────────────────
const thin = runPipeline(baseEmail(), opts);
const thinPayload = thin[0]?.payload || {};
check('the covering note alone yields no date', !thinPayload.startDate);
check('the covering note alone yields no venue', !(thinPayload.venue && thinPayload.venue.trim()));

// ── The gap test that decides whether a poster is read at all ──────────────
// Mirrors readPoster()'s trigger. The OLD rule additionally required CREATE_EVENT and a non-Institute
// club, which this mail fails on both counts — that is precisely why its poster was never opened.
const hasGap = (proposals) => !proposals.length || proposals.some((p) => {
    const pl = p.payload || {};
    return !pl.startDate || !(pl.venue && String(pl.venue).trim());
});
check('a poster read IS triggered for this mail', hasGap(thin) === true);
check('the old rule would have skipped it (not a CREATE_EVENT club item)',
    !thin.some((p) => p.mutation_type === 'CREATE_EVENT' && p.club && p.club !== 'Institute'));

// ── After: the poster's facts go back into the TEXT and the pipeline re-runs ──
const POSTER_BLOCK = '[From the attached poster]\nDate: 5 September 2026\nTime: 5:30 PM\nVenue: Convocation Hall';
const enriched = baseEmail();
enriched.body_text = `${COVERING_NOTE}\n\n${POSTER_BLOCK}`;
const after = runPipeline(enriched, opts);
const p0 = after[0]?.payload || {};

check('after the poster, a date is extracted', !!p0.startDate);
check('the date is the poster’s, not invented', String(p0.startDate).startsWith('2026-09-05'));
check('after the poster, a venue is extracted', !!(p0.venue && p0.venue.trim()));
check('the venue is the poster’s', /convocation/i.test(p0.venue || ''));
check('a time is picked up too', !!(p0.time_start || p0.startTime || p0.time));
// The whole point: with a date and venue present, the gap closes and the mail is no longer "empty".
check('the gap is closed, so no second poster read would fire', hasGap(after) === false);

// ── The block the code REALLY emits must parse ─────────────────────────────
// Gemini returns ISO ("2026-09-05") and the extractor does not read ISO. Building the block by hand in
// a test would have hidden that: it looks right, parses to nothing, and leaves the mail as empty as
// before. So run the actual function's output through the actual pipeline.
const realBlock = posterBlock({ date: '2026-09-05', time: '5:30 PM', venue: 'Convocation Hall' });
check('posterBlock writes the date as prose, not ISO', /5 September 2026/.test(realBlock));
const fromReal = baseEmail();
fromReal.body_text = `${COVERING_NOTE}\n\n${realBlock}`;
const realOut = runPipeline(fromReal, opts)[0]?.payload || {};
check('the real posterBlock output yields a date', String(realOut.startDate || '').startsWith('2026-09-05'));
check('the real posterBlock output yields a venue', /convocation/i.test(realOut.venue || ''));

const range = posterBlock({ date: '2026-09-05', end_date: '2026-09-07' });
check('a multi-day poster renders both ends as prose', /5 September 2026 to 7 September 2026/.test(range));
check('posterBlock returns null when the poster said nothing', posterBlock({}) === null);

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail ? 1 : 0);
