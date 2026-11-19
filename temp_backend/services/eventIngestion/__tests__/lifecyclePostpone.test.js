/**
 * Open-ended postponement — the two-email sequence, in order.
 * (run: node services/eventIngestion/__tests__/lifecyclePostpone.test.js)
 *
 * Regression for a live miss: CDC announced two sessions on 24 Aug 2026, then on 28 Aug wrote that
 * they "have been postponed for now". That phrasing matched NEITHER lifecycleCancelCues (which wanted
 * "postponed indefinitely") NOR lifecyclePatchCues (which wanted "postponed TO <date>"), so
 * detectLifecycle returned null and the cancellation was proposed as a fresh CREATE_NOTICE carrying
 * the same title as the already-published announcement. It was indistinguishable from a duplicate in
 * the review queue, was dismissed, and the sessions stayed on the feed.
 *
 * Both fixtures are the REAL mails, trimmed. The ordering assertions matter as much as the detection
 * one: a postponement that DOES name a new date must still be a PATCH, not a CANCEL.
 */
const { runPipeline, detectLifecycle } = require('../index');

const SN = 'students-notices@iitr.ac.in';
const CDC = 'CDC Office IIT Roorkee <office_cdc@iitr.ac.in>';
let pass = 0; let fail = 0;

const check = (name, got, want) => {
    if (got === want) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

// ── Step 1: the announcement (24 Aug) ────────────────────────────────────────
const announcement = {
    from: CDC, to: SN, subject: 'Placement Preparation Series: CDC X PIC',
    internal_date: Date.parse('2026-08-24T11:01:00+05:30'),
    body_text: `Dear Students,

Greetings from the Career Development Cell (CDC)!

We are thrilled to announce that the Career Development Cell (CDC), in collaboration with the Placement and Internship Cell (PIC), is organizing two impactful sessions designed to boost your placement preparation.

The sessions will be led by Mr. Avanish Mundhra, Founder and CEO of Cantilever Labs.

Session Details:
1. Art and Science of Resume Making
    * Date: 29th August 2026
    * Time: 6:00 PM
    * Venue: Mac Auditorium

2. Placement Interviews - Express to Impress
    * Date: 30th August 2026
    * Time: 6:00 PM
    * Venue: Mac Auditorium

Registration Link: https://forms.gle/ZxnzAu1CT8fbX5ud7

For any queries, please feel free to reach us at st_cdc@iitr.ac.in`,
};

const first = runPipeline(announcement, {})[0];
check('step 1: announcement is not a lifecycle mutation', detectLifecycle(announcement).type, null);
check('step 1: announcement creates something', /^CREATE_/.test(first.mutation_type), true);
check('step 1: announcement keeps its date', !!(first.payload.startDate || first.payload.event_date), true);

// ── Step 2: the postponement (28 Aug), sent AFTER the announcement ───────────
const postponement = {
    from: CDC, to: SN, subject: 'Re: Placement Preparation Series: CDC X PIC',
    internal_date: Date.parse('2026-08-28T22:22:49+05:30'),
    body_text: `Dear Students,

Greetings from the Career Development Cell (CDC)!

This is to inform you that the Resume Making and Placement Interview Preparation sessions scheduled for 29th and 30th August have been postponed for now due to an urgent health issue faced by the speaker, Mr. Avanish Mundhra.

The sessions will be conducted after a few days. The revised dates, timings, and mode of the sessions will be communicated to you soon.

We regret the inconvenience caused and appreciate your understanding.

For any queries, please feel free to reach us at st_cdc@iitr.ac.in`,
};

const lc = detectLifecycle(postponement);
const second = runPipeline(postponement, {})[0];
check('step 2: postponement detected as lifecycle', lc.type, 'CANCEL_EVENT');
check('step 2: postponement kind', lc.kind, 'postponed');
check('step 2: mutation is CANCEL_EVENT, not a fresh CREATE', second.mutation_type, 'CANCEL_EVENT');
check('step 2: evidence records the lifecycle', second.evidence.lifecycle, 'postponed');

// The whole point of the date-suppression rule: "scheduled for 29th and 30th August" names the slot
// being CALLED OFF. Before the fix this yielded startDate 2026-08-30 — re-asserting the cancelled day.
check('step 2: cancelled dates are NOT carried forward (startDate)', second.payload.startDate, null);
check('step 2: cancelled dates are NOT carried forward (endDate)', second.payload.endDate, null);
check('step 2: cancelled time is NOT carried forward', second.payload.time_start, null);
check('step 2: title survives for the reviewer to match on', typeof second.payload.title === 'string' && second.payload.title.length > 0, true);

// ── Ordering regressions — the specific cues that must still win ─────────────
const mk = (body, subject = 'Some Event') => ({ from: CDC, to: SN, subject, body_text: body });

check('postponed TO a date → PATCH_EVENT (patch cue wins)',
    detectLifecycle(mk('The session has been postponed to 5th September 2026 at 6 PM.')).type, 'PATCH_EVENT');
check('postponed INDEFINITELY → cancel kind (cancel cue is checked first)',
    detectLifecycle(mk('The session has been postponed indefinitely.')).kind, 'cancel');
check('rescheduled → PATCH_EVENT',
    detectLifecycle(mk('The event has been rescheduled to 6th September.')).type, 'PATCH_EVENT');
check('deadline extended → PATCH_NOTICE (not swallowed by the new cue)',
    detectLifecycle(mk('The last date for submission of applications has been extended to 5th September.')).type, 'PATCH_NOTICE');
check('a registration deadline extension mentioning postponement still routes to the NOTICE',
    detectLifecycle(mk('Owing to the postponement of the drive, the registration deadline has been extended to 10 September.')).type, 'PATCH_NOTICE');
check('plain reminder → no lifecycle',
    detectLifecycle(mk('Reminder: the session is tomorrow at 6 PM in Mac Auditorium.')).type, null);
check('ordinary announcement → no lifecycle',
    detectLifecycle(mk('We are organizing a workshop on 12 September at 5 PM, Convocation Hall.')).type, null);
check('"put on hold" → postponed',
    detectLifecycle(mk('The selection trials have been put on hold until further notice.')).kind, 'postponed');

// ── A PROMISED change is not a change: decide on data, not wording ───────────
// Real mail (CDC, 11 Jul 2026). Trips lifecyclePatchCues twice — on `postponement` in the subject and
// on `revised (date|time)` in the body — while stating NEITHER. Phrase-matching alone calls this a
// reschedule and publishes an empty patch over a live event; the extracted fields are what give it away.
const promisedOnly = {
    from: CDC, to: SN, subject: 'Interview Preparation Session – Postponement Notice',
    internal_date: Date.parse('2026-07-11T00:09:57+05:30'),
    body_text: `Dear Students,

We have received multiple requests to postpone the Internship Interview (Express to Impress) session due to internship OAs scheduled over the weekend. The revised date and time will be shared soon. Kindly follow the ongoing thread for updates.

For any further queries, you can reach out to Aaryan Kumar or Laksh Alawadhi.`,
};
const promised = runPipeline(promisedOnly, {})[0];
check('promised-but-unstated reschedule → downgraded to CANCEL_EVENT', promised.mutation_type, 'CANCEL_EVENT');
check('promised-but-unstated reschedule → kind postponed', promised.evidence.lifecycle, 'postponed');
check('downgrade is recorded in evidence', promised.evidence.downgraded_from, 'PATCH_EVENT');
check('promised-but-unstated reschedule carries no date', promised.payload.startDate, null);

// ...but a reschedule that DOES state a new value must stay a PATCH.
const withDate = runPipeline(mk('The session has been postponed to 5th September 2026 at 6:00 PM.'), {})[0];
check('reschedule WITH a new date stays PATCH_EVENT', withDate.mutation_type, 'PATCH_EVENT');
check('reschedule WITH a new date keeps it', withDate.payload.startDate, '2026-09-05');

// A venue-only move states no date but IS a real change — must not be downgraded.
const venueOnly = runPipeline(mk('Please note the venue has been changed to the Convocation Hall.'), {})[0];
check('venue-only change stays PATCH_EVENT', venueOnly.mutation_type, 'PATCH_EVENT');

// Real mail (Cultural Society, 12 Aug 2026) — the adversarial one. Says "has been postponed", which
// is exactly the new cue, but then STATES the replacement time. The downgrade must not fire: this is
// a genuine reschedule and turning it into a cancellation would pull a live event off the feed.
const statedShift = {
    from: 'fa.culsoc@iitr.ac.in', to: SN,
    subject: 'FW: Updated Timing | Dance Workshop | 12th August at 5:30 PM',
    internal_date: Date.parse('2026-08-12T10:22:33+05:30'),
    body_text: `Dear Students,

Important update!

After receiving several requests, the timing of the Dance Workshop has been postponed.

Date: 12th August
Venue: SAC OAT (1st Floor)
New Time: 5:30 PM onwards

Please be on time! The workshop will start sharp at 5:30 PM.

Regards,
Choreography and Dance Section`,
};
const stated = runPipeline(statedShift, {})[0];
check('"postponed" + a STATED new time stays PATCH_EVENT', stated.mutation_type, 'PATCH_EVENT');
check('...and keeps the new time', stated.payload.time_start, '17:30');
check('...and keeps the venue', stated.payload.venue, 'SAC OAT (1st Floor)');

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail ? 1 : 0);
