/**
 * Regression fixtures for topOnly() — the ingestion-time de-threading in source/gmail.js.
 *
 * WHY THIS FILE EXISTS: topOnly cut at the quoted-header boundary unconditionally. For a PASS-THROUGH
 * forward — where the forwarder writes nothing but "FYI" or a signature and the announcement IS the
 * quoted block — that discarded the entire email. Measured over 1431 broadcast mails: 48 bodies
 * reduced to a median ~130 chars, losing the apply-by on the Academic Registration notification, the
 * date on a TEDx invite and the venue on club recruitments. Because it happens BEFORE storage, no
 * downstream prompt or model change could recover it.
 *
 * The rule: fall through ONLY when the top carries no data of its own. A follow-up that states
 * something ("timing changed to 5:30 PM") keeps top-only precedence, so nothing stale is pulled up.
 *
 * Run: node services/eventIngestion/__tests__/topOnly.test.js
 */
const gmail = require('../source/gmail');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};

// minimal Gmail API message shape carrying a text/plain body
const msg = (subject, body) => ({
    id: 'x', threadId: 't', internalDate: String(Date.parse('2026-08-21T10:00:00+05:30')),
    payload: {
        headers: [
            { name: 'Subject', value: subject },
            { name: 'From', value: 'fa.culsoc@iitr.ac.in' },
            { name: 'To', value: 'students-notices@iitr.ac.in' },
            { name: 'Message-Id', value: '<t@iitr.ac.in>' },
        ],
        mimeType: 'text/plain',
        body: { data: Buffer.from(body, 'utf8').toString('base64url') },
    },
});
const bodyOf = (subject, text) => gmail.normalizeMessage(msg(subject, text)).body_text;

const QUOTED = [
    'From: Fine Arts IIT Roorkee <finearts@iitr.ac.in>',
    'Date: Friday, 21 August 2026 at 1:04 AM',
    'Subject: Fine Arts Recruitment 2026',
    '',
    'Date: 23 August',
    'Time: 11 AM',
    'Venue: SAC Ground Floor',
].join('\n');

// 1. pass-through forward: top is only a signature -> the quoted announcement must survive
{
    const out = bodyOf('FW: Fine Arts Recruitment 2026',
        `Warm regards,\nDr. Ram Manohar Singh\nHSS, IIT Roorkee\n\n${QUOTED}`);
    ok('pass-through forward keeps the quoted announcement', /SAC Ground Floor/.test(out) && /23 August/.test(out),
        `got ${JSON.stringify(out.slice(0, 120))}`);
}

// 2. top states its own logistics -> quoted history must STILL be dropped (no stale bleed-through)
{
    const out = bodyOf('Re: Dance Workshop',
        `Important update! The timing has been postponed.\nDate: 12th August\nVenue: SAC OAT\nNew Time: 5:30 PM onwards\n\n${QUOTED}`);
    ok('top with its own date/time drops the quoted block', !/SAC Ground Floor/.test(out) && /5:30 PM/.test(out),
        `got ${JSON.stringify(out.slice(0, 160))}`);
}

// 3. a short top that still carries data (a one-line correction) must not pull the quote up
{
    const out = bodyOf('Re: Venue change', `Venue moved to LHC-101.\n\n${QUOTED}`);
    ok('short top carrying a venue still drops the quote', !/SAC Ground Floor/.test(out),
        `got ${JSON.stringify(out.slice(0, 160))}`);
}

// 4. a long top is substantive by definition, even with no date -> quote dropped
{
    const out = bodyOf('Re: Long note', `${'This is a genuinely long note without any logistics. '.repeat(12)}\n\n${QUOTED}`);
    ok('long top drops the quote even with no date', !/SAC Ground Floor/.test(out));
}

// 5. no quoted block at all -> unchanged
{
    const out = bodyOf('Plain', 'Date: 23 August\nVenue: SAC Ground Floor');
    ok('plain body passes through untouched', /SAC Ground Floor/.test(out));
}

// 6. "On ... wrote:" reply chains follow the same rule
{
    const out = bodyOf('Re: thread',
        `FYI, please.\n\nOn Tue, 11 Aug 2026 at 13:09, Fine Arts <finearts@iitr.ac.in> wrote:\nDate: 23 August\nVenue: SAC Ground Floor`);
    ok('wrapper above an "On ... wrote:" chain keeps the quoted content', /SAC Ground Floor/.test(out),
        `got ${JSON.stringify(out.slice(0, 140))}`);
}

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail ? 1 : 0);
