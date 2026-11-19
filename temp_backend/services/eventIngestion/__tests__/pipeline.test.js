/**
 * Deterministic pipeline smoke test (run: node services/eventIngestion/__tests__/pipeline.test.js).
 * Fixtures are trimmed versions of real IITR broadcasts. Asserts gate verdict,
 * attribution, classification and key categories — the Inbox-Replay regression net.
 */
const { runPipeline, attribute, classifyNoticeKind, senderVerified } = require('../index');

const senderMap = {
    'cinemaclub@iitr.ac.in': 'Cinema Club',
    'cognizance@iitr.ac.in': 'Cognizance',
    'hec@iitr.ac.in': 'Himalayan Explorers Club',
};
const SN = 'students-notices@iitr.ac.in';

const fixtures = [
    {
        name: 'Cinema Club screening → event/Cinema Club/Cultural',
        email: { from: 'Cinema Club <cinemaclub@iitr.ac.in>', to: SN, subject: 'Cinema Club Screening : Main Vaapas Aaunga',
            body_text: 'Cinema Club presents a screening. Schedule: Saturday, 18th July | 9:00 PM. Venue : Convocation Hall.' },
        expect: { mutation_type: 'CREATE_EVENT', club: 'Cinema Club', category: 'Cultural & Fests' },
    },
    {
        name: 'Special Lecture → event/Institute/Talks',
        email: { from: 'Head Management Studies <head@ms.iitr.ac.in>', to: SN, subject: 'Special Lecture by Sh Ashok Kumar at APJ 103',
            body_text: 'All are welcome to attend the Guest Lecture. The session is on July 18, 2026 at 10 am at APJ 103.' },
        expect: { mutation_type: 'CREATE_EVENT', club: 'Institute', category: 'Talks & Lectures' },
    },
    {
        name: 'Triathlon → event/Institute/Sports',
        email: { from: 'Coordinator FIM <fitindia@iitr.ac.in>', to: SN, subject: 'Uttaranchal State Triathlon Championship 2026',
            body_text: 'The Institute Sports Council is organizing the Triathlon on 27th July 2026. The competition will commence at 7:00 AM.' },
        expect: { mutation_type: 'CREATE_EVENT', club: 'Institute', category: 'Sports & Fitness' },
    },
    {
        // GENERAL, not important — and that is the point of the case. The link is
        // harchhatravratti.highereduhry.ac.in, the HARYANA STATE GOVERNMENT scholarship portal, so the
        // scheme is run by an outside body. Under the consequence-based rule an outside scholarship is
        // an opportunity a student may choose to take, not an institute obligation they are penalised
        // for missing — so it shows with its deadline chip but never earns the pinned band.
        //
        // This expectation was 'important' before is_external existed, when any title containing
        // "scholarship" was pinned. That rule put 66% of notices in the band, which is why it changed.
        name: 'Kalpana Chawla scholarship → notice/general/external/Girls-only',
        email: { from: 'awards <awards@iitr.ac.in>', to: SN, subject: 'Kalpana Chawla Chhatravrati Yojna (Girls Only)',
            body_text: 'Please find the poster. Students may apply through the following link https://harchhatravratti.highereduhry.ac.in' },
        expect: { mutation_type: 'CREATE_NOTICE', priority: 'general', is_external: true, audienceRe: /girls only/i, kind: 'scholarship', opportunity: true },
    },
    {
        name: 'Fee Payment → notice/important',
        email: { from: 'UG AAO <aao-ug@iitr.ac.in>', to: SN, subject: 'Notification: Fee Payment for Autumn Semester 2026-27',
            body_text: 'The Fee Payment notification is on channel i. Last date to pay the semester fees is 15 August 2026.' },
        // a fee carries a due-date but is NOT an apply-for opportunity — it must stay in "Info".
        expect: { mutation_type: 'CREATE_NOTICE', priority: 'important', kind: 'fee', opportunity: false },
    },
    {
        name: 'Viva-Voce (personal: name+enrolment) → HARD-drop via sensitive wall, even with attend/date signals',
        email: { from: 'Head Chemistry <head@cy.iitr.ac.in>', to: SN, subject: 'Open Notice for Ph.D. Viva-Voce Examination of Mr. Kunal Rao',
            body_text: 'All are cordially invited to attend the open seminar. Name of Student Mr. Kunal Rao Enrolment No. 21918008. Date: 5 May 2026 at 11 AM, Seminar Hall.' },
        expect: { mutation_type: 'DISMISS', reason: 'gate_sensitive' },
    },
    {
        name: 'OTP direct-to-me → DISMISS (not broadcast)',
        email: { from: 'AAO IITR <donotreply-acad@iitr.ac.in>', to: 'adbhut_k@ee.iitr.ac.in', subject: 'OTP For Login in AIS',
            body_text: 'Your OTP is 123456.' },
        expect: { mutation_type: 'DISMISS', reason: 'gate1_not_broadcast' },
    },
    {
        name: 'External unstop spam → DISMISS (off-domain)',
        email: { from: 'Jia from Unstop <noreply@unstop.news>', to: 'adbhut_k@ee.iitr.ac.in', subject: 'Earn stipend upto INR 25,000',
            body_text: 'Apply now.' },
        expect: { mutation_type: 'DISMISS', reason: 'gate0_offdomain' },
    },
    {
        name: 'Cognizance hackathon → event/Cognizance/Competitions',
        email: { from: 'Cognizance IIT Roorkee <cognizance@iitr.ac.in>', to: SN, subject: 'HiLabs Agentic AI Hackathon || Cognizance 2026',
            body_text: 'Join us for the HiLabs Agentic AI Hackathon on 9 March 2026.' },
        expect: { mutation_type: 'CREATE_EVENT', club: 'Cognizance', category: 'Competitions & Hackathons' },
    },
    {
        name: 'Exam schedule → NOTICE now (not calendar — exam is not a day-status)',
        email: { from: 'Time Table AAO <aao-timetable@iitr.ac.in>', to: SN, subject: 'Final ETE Schedule Autumn Sem 2025-26',
            body_text: 'Please refer to the schedule on Channel-i.' },
        expect: { mutation_type: 'CREATE_NOTICE' },
    },
    {
        name: 'Teaching day → calendar, cal_kind=working',
        email: { from: 'AR Curriculum <arcurriculum@iitr.ac.in>', to: SN, subject: 'Teaching Day on November 08, 2025 (Saturday)',
            body_text: 'November 08, 2025 (Saturday) shall follow the timetable of Monday.' },
        expect: { mutation_type: 'CALENDAR_ENTRY', calKind: 'working' },
    },
    {
        name: 'Holiday reschedule → calendar, cal_kind=holiday',
        email: { from: 'AR General Administration <ar.gadm@iitr.ac.in>', to: SN, subject: 'Observation of Holiday Id-ul-Zuha on 28.05.2026 instead of 27.05.2026',
            body_text: 'It is notified that the holiday for Id-ul-Zuha will be observed on 28.05.2026 (Thursday) instead of 27.05.2026.' },
        expect: { mutation_type: 'CALENDAR_ENTRY', calKind: 'holiday' },
    },
    {
        name: 'E-Sports PoRs recruitment → notice/opportunity (NOT event)',
        email: { from: 'General Secretary Sports Affairs <gensec-sports@iitr.ac.in>', to: SN, subject: 'Call For E-Sports PoRs Applications | 2026-27',
            body_text: 'Applications are open for E-Sports Positions of Responsibility for the session 2026-27. Interested students may apply via the form by 30 June 2026.' },
        expect: { mutation_type: 'CREATE_NOTICE', priority: 'important', kind: 'recruitment', opportunity: true },
    },
    {
        name: 'Facility kind + sports category → (c) demoted: NOT sent to Groq, flagged AMBIG_CROSS_CATEGORY',
        email: { from: 'Sports Office <sportsoffice@iitr.ac.in>', to: SN, subject: 'Swimming Pool — revised slots and timings',
            body_text: 'The revised swimming pool slots and timings are out. Swimming coaching sessions resume Monday.' },
        expect: { mutation_type: 'CREATE_NOTICE', kind: 'facility', opportunity: false, reasonCodes: ['AMBIG_CROSS_CATEGORY'] },
    },
    {
        name: 'THIN SUBJECT: one-word subject "lecture" → title mined from body Topic line + venue extracted',
        email: { from: 'Head Civil Engineering <head@ce.iitr.ac.in>', to: SN, subject: 'lecture',
            body_text: 'You are cordially invited for the talk by Dr. Raja Sengupta, McGill University.\nDate: 16 July 2026\nTime: 11 AM\nVenue: Conference Room, Civil Engg Department\nTopic: Using Emerging Geospatial Technologies to Understand Patterns of Vulnerability in Cities' },
        expect: { mutation_type: 'CREATE_EVENT', titleRe: /Geospatial Technologies/i, venue: 'Conference Room, Civil Dept' },   // normalised — see venue.js
    },
    {
        name: 'STRUCTURED FIELDS: date/time stripped from NAME; time_start + venue as separate fields',
        email: { from: 'Head Civil Engineering <head@ce.iitr.ac.in>', to: SN, subject: 'Special Lecture - by Sh Ashok Kumar Ex DGP Uttarakhand _ 18 July at 10 am',
            body_text: 'Date: 18 July 2026\nTime: 10 AM\nVenue: APJ 103' },
        expect: { mutation_type: 'CREATE_EVENT', titleRe: /Special Lecture/i, nameCleanOf: 'july|10\\s*am|18', timeStart: '10:00', venue: 'APJ-103' },   // normalised — see venue.js
    },
    // ── privacy wall + soft-deny override ────────────────────────────────────
    {
        name: 'PRIVACY: grades mailed to me personally by a muted sender → DISMISS (not broadcast)',
        email: { from: 'Registrar <registrar@iitr.ac.in>', to: 'adbhut_k@ee.iitr.ac.in', subject: 'Your Grade Card — Autumn Semester',
            body_text: 'Your SGPA this semester is 8.4. Grade card attached.' },
        expect: { mutation_type: 'DISMISS', reason: 'gate1_not_broadcast' },
    },
    {
        name: 'PRIVACY: a merit list of named students broadcast to a list → DISMISS (sensitive)',
        email: { from: 'UG AAO <aao-ug@iitr.ac.in>', to: SN, subject: 'Provisional Merit List of Selected Candidates',
            body_text: 'The provisional merit list of selected candidates with roll numbers: 21114001, 21114002 is below.' },
        expect: { mutation_type: 'DISMISS', reason: 'gate_sensitive' },
    },
    {
        name: 'PRIVACY: identity/finance (Aadhaar + bank account) broadcast → DISMISS (sensitive)',
        email: { from: 'Accounts <accounts@iitr.ac.in>', to: SN, subject: 'Submit Bank Account and Aadhaar for stipend disbursement',
            body_text: 'Students must submit their bank account number and Aadhaar card copy for scholarship disbursement.' },
        expect: { mutation_type: 'DISMISS', reason: 'gate_sensitive' },
    },
    {
        name: 'SAFE: a generic "results declared, check Channel-i" broadcast is NOT PII → not dropped',
        email: { from: 'Exam Cell <examcell@iitr.ac.in>', to: SN, subject: 'Autumn Semester Results Declared',
            body_text: 'The results for the Autumn Semester have been declared. Students may check their result on Channel-i.' },
        expect: { notDismissed: true },
    },
    {
        name: 'SECURITY: random person emails the dev directly (keyword-stuffed, no PII) → DISMISS (not broadcast)',
        email: { from: 'random.student@iitr.ac.in', to: 'adbhut_k@ee.iitr.ac.in', subject: 'FREE FOOD Party Hackathon Event!!!',
            body_text: 'Attend the event on 5 Aug at 5 PM in LHC. Free pizza, register now!' },
        expect: { mutation_type: 'DISMISS', reason: 'gate1_not_broadcast' },
    },
    {
        name: 'PRIVACY: appointment roster exposing "Enrollment No." (double-L spelling) → DISMISS (sensitive)',
        email: { from: 'CDC Office <office_cdc@iitr.ac.in>', to: SN, subject: 'Appointment of General Secretary, CDC Student Team 2026-27',
            body_text: 'The following students have been appointed: 1. Mr. Naman Goyal Enrollment No.: 23115090 Mobile: 9465228774.' },
        expect: { mutation_type: 'DISMISS', reason: 'gate_sensitive' },
    },
    {
        name: 'GOVERNANCE: nodal-officer change — "fellowship" keyword must NOT rescue it → DISMISS (hard)',
        email: { from: 'Assoc Dean <adaa@iitr.ac.in>', to: SN, subject: 'Change in Nodal Officer for the IndiaAI Research Fellowship',
            body_text: 'I will now serve as the Nodal Officer for the IndiaAI Fellowship. Direct inquiries to me.' },
        expect: { mutation_type: 'DISMISS', reason: 'gate_governance' },
    },
    {
        name: 'PRIVACY: condolence message (about a named person) → DISMISS (sensitive)',
        email: { from: 'Dean StudentWelfare <deansw@iitr.ac.in>', to: SN, subject: 'Condolence Message',
            body_text: 'It is with deep sorrow that we inform the sad demise of a research scholar of the institute.' },
        expect: { mutation_type: 'DISMISS', reason: 'gate_sensitive' },
    },
    {
        name: 'GOVERNANCE: commercial shipping promo → DISMISS (hard)',
        email: { from: 'GS Hostel <gensec.hostel@iitr.ac.in>', to: SN, subject: 'Delhivery Campus Express — up to 30% discount on shipping',
            body_text: 'Special shipping offer for final-year students moving out. Up to 30% discount on shipping charges.' },
        expect: { mutation_type: 'DISMISS', reason: 'gate_governance' },
    },
    {
        name: 'OVERRIDE: muted sender (Registrar) but a real HOLIDAY notice → comes through as calendar',
        email: { from: 'Registrar <registrar@iitr.ac.in>', to: SN, subject: 'Institute Holiday on 15 August 2026',
            body_text: 'The Institute will remain closed on 15 August 2026 on account of Independence Day.' },
        expect: { mutation_type: 'CALENDAR_ENTRY' },
    },
    {
        name: 'OVERRIDE: muted sender (finance) but a real FEE deadline → comes through as Info notice',
        email: { from: 'Finance <noreply.finance@iitr.ac.in>', to: SN, subject: 'Fee Payment last date for Autumn Semester 2026-27',
            body_text: 'Please complete the fee payment on Channel-i by 20 August 2026.' },
        expect: { mutation_type: 'CREATE_NOTICE', kind: 'fee', opportunity: false },
    },
    {
        name: 'NO OVERRIDE: muted sender with pure governance noise → stays DISMISS',
        email: { from: 'Registrar <registrar@iitr.ac.in>', to: SN, subject: 'Minutes of the Senate Meeting',
            body_text: 'Please find the minutes of the last Senate meeting.' },
        expect: { mutation_type: 'DISMISS', reason: 'gate2_deny_sender' },
    },
    // ── A/B uncertainty split (items 2+3) ────────────────────────────────────
    {
        name: 'Deterministic fallback: attend-intent notice → CREATE_NOTICE',
        email: { from: 'Cult Council <gensec.cult@iitr.ac.in>', to: SN, subject: 'Cultural Evening',
            body_text: 'Please join us and participate in the cultural evening next week. All students are invited to the celebration in a big way.' },
        expect: { mutation_type: 'CREATE_NOTICE' },
    },
    {
        name: 'Reason codes: attachment-only thin body → WEAK codes attached',
        email: { from: 'Dean <deanaa@iitr.ac.in>', to: SN, subject: 'Notice',
            body_text: 'Please see the attached circular.' },
        expect: { mutation_type: 'CREATE_NOTICE', reasonCodes: ['WEAK_ATTACHMENT_ONLY', 'WEAK_TOO_SHORT'] },
    },
    {
        name: 'Class B: Channel-i login link → WEAK_LOGIN_LINK (real channeli.in domain)',
        email: { from: 'AAO <aao-ug@iitr.ac.in>', to: SN, subject: 'Important Update',
            body_text: 'The complete details are available — please login to view them on the channeli.in portal at your end.' },
        expect: { mutation_type: 'CREATE_NOTICE', reasonCodes: ['WEAK_LOGIN_LINK'] },
    },
    // ── recruitment precedence (item 1) + registration_deadline (item 6) ──────
    {
        name: 'Recruitment TALK (attend-format) → EVENT',
        email: { from: 'gensec.technical@iitr.ac.in', to: SN, subject: 'Invitation to E-Cell IIT Roorkee Recruitment Talk',
            body_text: 'Come to the E-Cell recruitment talk on 5 August 2026 at 6 PM to learn about joining the team.' },
        expect: { mutation_type: 'CREATE_EVENT' },
    },
    {
        name: 'Recruitment ANNOUNCEMENT (applications open, no attend-format) → NOTICE / opportunity',
        email: { from: 'gensec.cult@iitr.ac.in', to: SN, subject: 'Join Team Cognizance 2026 — Recruitment Open for Coordinators & Volunteers',
            body_text: 'Applications are open to join Team Cognizance 2026 as a coordinator or volunteer. Apply via the form by 10 February 2026.' },
        expect: { mutation_type: 'CREATE_NOTICE', kind: 'recruitment', opportunity: true },
    },
    {
        name: 'Fellowship ANNOUNCEMENT (advertisement, apply-by) → NOTICE / opportunity (not event)',
        email: { from: 'awards <awards@iitr.ac.in>', to: SN, subject: 'Sun Pharma Science Foundation Fellowships 2026',
            body_text: 'Applications are invited for the Sun Pharma Science Scholar awards. Eligible students may apply by 30 April 2026.' },
        expect: { mutation_type: 'CREATE_NOTICE', kind: 'scholarship', opportunity: true },
    },
    {
        name: 'Cancellation follow-up → CANCEL_EVENT (not a fresh CREATE)',
        email: { from: 'Cinema Club <cinemaclub@iitr.ac.in>', to: SN, subject: 'Cancelled: Cinema Club Screening',
            body_text: 'The screening scheduled for tonight stands cancelled due to unforeseen reasons.' },
        expect: { mutation_type: 'CANCEL_EVENT' },
    },
    {
        name: 'Reschedule follow-up → PATCH_EVENT',
        email: { from: 'gensec.technical@iitr.ac.in', to: SN, subject: 'Change in Test Timing for QCG Recruitment',
            body_text: 'The QCG recruitment test timing has been changed to 7 PM on 11 February 2026.' },
        expect: { mutation_type: 'PATCH_EVENT' },
    },
    {
        name: 'Online multi-day event → venue "Online", date range endpoints extracted',
        email: { from: 'gensec.technical@iitr.ac.in', to: SN, subject: 'HackByte 2026 | SDSLabs',
            body_text: 'Join us for HackByte from 12-14 March 2026 on Google Meet. All welcome to attend.' },
        expect: { mutation_type: 'CREATE_EVENT', venue: 'Online', endDate: '2026-03-14' },
    },
    {
        name: 'Event with distinct register-by date → registration_deadline set, start = event date',
        email: { from: 'gensec.technical@iitr.ac.in', to: SN, subject: 'HackByte 2026 | SDSLabs',
            body_text: 'Join us for HackByte on 20 September 2026 at MAC. Register by 5 September 2026 to participate.' },
        expect: { mutation_type: 'CREATE_EVENT', regDeadline: '2026-09-05' },
    },
    // ── category rules added 2026-08-25 ──────────────────────────────────────────────────────────
    // Each of these is a real shape that produced NO category at all before. Measured over a year,
    // these terms took the uncategorised events from 90/411 (21.9%) down to 50/411 (12.2%).
    {
        name: 'trek → Sports (HEC runs these all year; none were categorised)',
        email: { from: 'hec@iitr.ac.in', to: SN, subject: 'HEC: Valley of Flowers & Hemkund Sahib Trek',
            body_text: 'Gear up! The trek departs on 12 September 2026. Reporting at LBS Ground, 6:00 AM.' },
        expect: { mutation_type: 'CREATE_EVENT', category: 'Sports & Fitness' },
    },
    {
        name: 'exhibition → Cultural',
        email: { from: 'adii@iitr.ac.in', to: SN, subject: 'Invitation to STC Tech Exhibition',
            body_text: 'You are invited to the exhibition on 23 August 2026, 10 am onwards at Gargi Block.' },
        expect: { mutation_type: 'CREATE_EVENT', category: 'Cultural & Fests' },
    },
    {
        name: 'conference → Talks (assembling to hear speakers, same shape as a seminar)',
        email: { from: 'gensec.pgacads@iitr.ac.in', to: SN, subject: 'ICPS National Academic Conference 2026',
            body_text: 'The conference will be held on 3 October 2026 at Convocation Hall. All are welcome to attend.' },
        expect: { mutation_type: 'CREATE_EVENT', category: 'Talks & Lectures' },
    },
    {
        name: 'treasure hunt → Competitions',
        email: { from: 'sangram@iitr.ac.in', to: SN, subject: 'Join Treasure Hunt by Team Sangram on August 9th',
            body_text: 'Join us for the treasure hunt on 9 August 2026 at LBS Ground, 4:00 PM. Teams of four.' },
        expect: { mutation_type: 'CREATE_EVENT', category: 'Competitions & Hackathons' },
    },
    {
        name: 'mock interview → Recruitments',
        email: { from: 'office_cdc@iitr.ac.in', to: SN, subject: 'Mock Interviews For Internship Season 2026-27',
            body_text: 'Mock interviews will be held on 14 September 2026 at APJ-103. Slots are limited.' },
        expect: { mutation_type: 'CREATE_EVENT', category: 'Recruitments & PORs' },
    },
    // NEGATIVE: "discussion" scored 2 gain : 21 collateral and was deliberately REJECTED. If someone
    // adds it later this fixture fails — a routine committee meeting is not a lecture.
    {
        name: 'bare "discussion" must NOT become Talks (rejected term, 2:21)',
        email: { from: 'adoswsa@iitr.ac.in', to: SN, subject: 'Hostel Committee Discussion',
            body_text: 'A discussion regarding mess arrangements will be held on 11 September 2026 at Cautley Bhawan.' },
        expect: { mutation_type: 'CREATE_EVENT', notCategory: 'Talks & Lectures' },
    },
];

let pass = 0, fail = 0;
for (const f of fixtures) {
    const [p] = runPipeline(f.email, { senderMap });
    const errs = [];
    const e = f.expect;
    if (e.mutation_type && p.mutation_type !== e.mutation_type) errs.push(`mutation ${p.mutation_type}≠${e.mutation_type}`);
    if (e.notDismissed && p.mutation_type === 'DISMISS') errs.push(`unexpectedly DISMISSED (reason ${p.reason})`);
    if (e.reason && p.reason !== e.reason) errs.push(`reason ${p.reason}≠${e.reason}`);
    if (e.club && p.club !== e.club) errs.push(`club ${p.club}≠${e.club}`);
    if (e.priority && (!p.payload || p.payload.priority !== e.priority)) errs.push(`priority ${p.payload && p.payload.priority}≠${e.priority}`);
    if (e.category && (!p.payload || !(p.payload.categories || []).includes(e.category))) errs.push(`category missing ${e.category} (got ${p.payload && p.payload.categories})`);
    // notCategory locks a DELIBERATELY REJECTED term — it fails if someone widens a rule back onto it.
    if (e.notCategory && p.payload && (p.payload.categories || []).includes(e.notCategory)) errs.push(`category ${e.notCategory} should NOT have been assigned (got ${p.payload.categories})`);
    if (e.audienceRe && (!p.payload || !e.audienceRe.test(p.payload.audience || ''))) errs.push(`audience ${p.payload && p.payload.audience} !~ ${e.audienceRe}`);
    if (e.kind && (!p.payload || p.payload.kind !== e.kind)) errs.push(`kind ${p.payload && p.payload.kind}≠${e.kind}`);
    if ('opportunity' in e && (!p.payload || !!p.payload.is_opportunity !== e.opportunity)) errs.push(`opportunity ${p.payload && p.payload.is_opportunity}≠${e.opportunity}`);
    if ('is_external' in e && (!p.payload || !!p.payload.is_external !== e.is_external)) errs.push(`is_external ${p.payload && p.payload.is_external}≠${e.is_external}`);
    if ('uncertain' in e && !!p._uncertain !== e.uncertain) errs.push(`uncertain ${!!p._uncertain}≠${e.uncertain}`);
    if (e.reasonCodes) {
        const got = (p.evidence && p.evidence.reason_codes) || [];
        for (const rc of e.reasonCodes) if (!got.includes(rc)) errs.push(`reason_code missing ${rc} (got ${got})`);
    }
    if (e.regDeadline && (!p.payload || p.payload.registration_deadline !== e.regDeadline)) errs.push(`regDeadline ${p.payload && p.payload.registration_deadline}≠${e.regDeadline}`);
    if (e.calKind && (!p.payload || p.payload.cal_kind !== e.calKind)) errs.push(`calKind ${p.payload && p.payload.cal_kind}≠${e.calKind}`);
    if (e.venue && (!p.payload || p.payload.venue !== e.venue)) errs.push(`venue ${p.payload && p.payload.venue}≠${e.venue}`);
    if (e.titleRe && (!p.payload || !e.titleRe.test(p.payload.title || ''))) errs.push(`title "${p.payload && p.payload.title}" !~ ${e.titleRe}`);
    if (e.nameCleanOf && p.payload && new RegExp(e.nameCleanOf, 'i').test(p.payload.title || '')) errs.push(`name still contains ${e.nameCleanOf}: "${p.payload.title}"`);
    if (e.timeStart && (!p.payload || p.payload.time_start !== e.timeStart)) errs.push(`time_start ${p.payload && p.payload.time_start}≠${e.timeStart}`);
    if (e.endDate && (!p.payload || p.payload.endDate !== e.endDate)) errs.push(`endDate ${p.payload && p.payload.endDate}≠${e.endDate}`);
    if ('calendarLinkOnly' in e && (!p.payload || !!p.payload.calendarLinkOnly !== e.calendarLinkOnly)) errs.push(`linkOnly ${p.payload && p.payload.calendarLinkOnly}≠${e.calendarLinkOnly}`);
    if (errs.length) { fail++; console.log(`❌ ${f.name}\n     ${errs.join('; ')}`); }
    else { pass++; console.log(`✅ ${f.name}`); }
}

// relay attribution unit checks. A gensec relay is resolved against the club ROSTER, so these need a
// clubIndex — in production runner.js builds it from the club table (longest alias first).
const testClubIndex = [
    ['finance club', 'Finance Club'], ['cognizance', 'Cognizance'], ['cinema club', 'Cinema Club'],
].sort((a, b) => b[0].length - a[0].length);
const relayChecks = [
    { email: { from: 'gensec.technical@iitr.ac.in', subject: 'AMS Derive 2026 | Finance Club IITR' }, want: 'Finance Club' },
    { email: { from: 'gensec.technical@iitr.ac.in', subject: 'Hackathons || Cognizance 2026' }, want: 'Cognizance' },
];
for (const r of relayChecks) {
    const got = attribute(r.email, senderMap, testClubIndex).club;
    if (got === r.want) { pass++; console.log(`✅ relay attribution → ${r.want}`); }
    else { fail++; console.log(`❌ relay attribution: got "${got}" want "${r.want}"`); }
}

// notice-KIND classifier: tightened regexes must not over-match ("registration fee" ≠ Fee/Registration).
const kindChecks = [
    { blob: 'AU Inter-University Essay Writing Competition 2026', want: 'competition' },
    { blob: 'Participate in Aerothon 2026 – HAL x IIT Indore National Aerospace Hackathon', want: 'competition' },
    { blob: 'Please pay the registration fee of Rs 500 to confirm your seat', want: 'notice' },
    { blob: 'Notification: Fee Payment for Autumn Semester 2026-27 is due', want: 'fee' },
    { blob: 'ACADEMIC REGISTRATION FOR AUTUMN SEMESTER 2026-27', want: 'registration' },
    { blob: 'Revised swimming pool slots and timings', want: 'facility' },
    { blob: 'Kalpana Chawla Chhatravrati Yojna for Engineering Students', want: 'scholarship' },
    { blob: 'An invited talk on "DAG Scheduler for Blockchains as a Case Study" by Dr Peri', want: 'notice' },
];
for (const c of kindChecks) {
    const got = classifyNoticeKind(c.blob, {}).key;
    if (got === c.want) { pass++; console.log(`✅ kind "${c.want}" ← ${c.blob.slice(0, 40)}`); }
    else { fail++; console.log(`❌ kind: got "${got}" want "${c.want}" ← ${c.blob.slice(0, 40)}`); }
}

// sender verification (trust badge): offices/clubs verified, random individuals flagged
const senderChecks = [
    ['head@ms.iitr.ac.in', true], ['gensec.technical@iitr.ac.in', true], ['awards@iitr.ac.in', true], ['nss@iitr.ac.in', true],
    ['21114567@iitr.ac.in', false], ['random.student@iitr.ac.in', false], ['student_x@ec.iitr.ac.in', false],
];
for (const [f, want] of senderChecks) {
    const got = senderVerified({ from: f }, {});
    if (got === want) { pass++; console.log(`✅ sender ${want ? 'verified' : 'unverified'} ← ${f}`); }
    else { fail++; console.log(`❌ sender: ${f} got ${got} want ${want}`); }
}

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail ? 1 : 0);
