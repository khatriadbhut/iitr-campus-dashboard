/**
 * Regression fixtures for the body-cleaning / notice-shaping work.
 *
 * WHY THIS FILE EXISTS: all of this behaviour was previously protected by nothing. pipeline.test.js
 * covers classification and extraction, but never touched cleanBody, the newline handling, the
 * apply-by vs happens-on split, the contact-line filter or the sender-authenticity gate. Every case
 * below is a real bug that was found and fixed — they are here so it stays fixed.
 *
 * Run: node services/eventIngestion/__tests__/cleaning.test.js
 */
const IX = require('../index');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
// ingestion normalises whitespace but PRESERVES newlines — mirror that here, since every cleaner is line-based
const norm = (t) => String(t).replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ')
    .split('\n').map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const email = (subject, body, extra = {}) => ({
    subject, body_text: norm(body), from: 'gensec.technical@iitr.ac.in',
    to: 'students-notices@iitr.ac.in', internal_date: new Date('2026-08-01T14:10:33+05:30'), ...extra,
});

console.log('\n── cleanBody: ceremony out, structure in ──');
{
    const raw = `Dear Students,

Greetings from PAG!

*Venue:* MAC Auditorium
Time: 4:00 PM

We are inviting enthusiastic individuals to join the organising team.

* Role: Organising Committee
* Stipend: none

Regards,
Rajarshi Verma
Deputy General Secretary
IIT Roorkee
Phone: +91 9000000002`;
    const c = IX.cleanBody(norm(raw));
    ok('salutation dropped', !/dear students/i.test(c.text), c.text.slice(0, 60));
    ok('signature block dropped', !/rajarshi|deputy general/i.test(c.text));
    ok('phone line dropped', !/9000000002/.test(c.text));
    ok('Zimbra *bold* unwrapped', /Venue: MAC Auditorium/.test(c.text) && !/\*Venue/.test(c.text));
    ok('labelled lines kept as details', c.details.some((d) => /^Venue: MAC Auditorium$/.test(d)));
    ok('bullet content kept, marker stripped', c.details.some((d) => /^Role: Organising Committee$/.test(d)),
        JSON.stringify(c.details));
    ok('bullet first letter NOT eaten', !c.details.some((d) => /^ole:|^tipend:/.test(d)), JSON.stringify(c.details));
}

console.log('\n── hard-wrapped prose is reflowed, not truncated mid-sentence ──');
{
    const raw = `The International Collegiate Programming Contest is the world's
oldest and most prestigious competitive programming contest for
university students, fostering collaboration and the ability to
perform under
pressure.`;
    const c = IX.cleanBody(norm(raw));
    ok('wrapped sentence rejoined', /perform under pressure\./.test(c.text), c.text.slice(-70));
    ok('short continuation line not dropped', /pressure/.test(c.text));
}

console.log('\n── orphan list markers (Outlook / html-to-text) ──');
{
    const raw = `Registrations are open for the three regional sites:

   -

   Amritapuri
   -

   Kanpur

Each team may participate in at most two regional sites.`;
    const c = IX.cleanBody(norm(raw));
    ok('marker rejoined with its item', c.details.some((d) => /^Amritapuri$/.test(d)), JSON.stringify(c.details));
    ok('paragraph after the list NOT absorbed into the bullet',
        !c.details.some((d) => /Each team may participate/.test(d)), JSON.stringify(c.details));
}

// POLICY CHANGE 2026-08-22, at the user's direction: a NAMED point of contact circulated on a
// broadcast list is not personal data — it is the club's published POC, and a student needs it to ask
// about the event. These fixtures previously asserted that "Vivek - 9000000003" was dropped; they now
// assert it is kept. What still drops is an UNNAMED number ("Contact +91 …", an office/cell block),
// which gives a reader nothing to act on. The PII wall and the broadcast gate are unchanged and still
// run before any of this — a personal number in non-broadcast mail never reaches here.
console.log('\n── organiser contact lines: keep NAMED POCs, drop bare numbers ──');
{
    const drop = ['Contact +91 9000000002', 'Cell:09000000004; (O) 01332-285014'];
    const keep = ['Eligibility: 2nd & 3rd Year Students', 'First Prize - Rs 15,000',
        'Deadline: 4 August, 2026 EOD', 'Registration fee of Rs 50000 applies',
        'Venue: APJ Abdul Kalam Block, Room 004',
        '* Vivek - 9000000003', 'Laksh Alawadhi: 9000000005', '📞 Subhra: 9000000006'];
    drop.forEach((l) => ok(`drops  ${l.slice(0, 34)}`, IX.cleanBody(l).text.length === 0));
    keep.forEach((l) => ok(`keeps  ${l.slice(0, 34)}`, IX.cleanBody(l).text.length > 0));
}

console.log('\n── notice: apply-by vs happens-on are different fields ──');
{
    // ICPC: "registrations are now open" matches the broad classification cue but says nothing about a
    // CLOSING date, so 3 October is when it HAPPENS, not a deadline. Storing it as a deadline both
    // mislabelled it and expired the notice early.
    const p = IX.runPipeline(email('PAG | ICPC 2026 Prelims Registration Instructions',
        `The ICPC 2026 Prelims are scheduled to be held on 3rd October, and
registrations for the three regional sites are now open.`), { senderMap: {}, clubIndex: [] })[0];
    eq('event_date holds the date', p.payload.event_date, '2026-10-03');
    eq('deadline stays empty (no closing phrase)', p.payload.deadline || null, null);

    const q = IX.runPipeline(email('Scholarship applications',
        `Applications are invited for the merit scholarship.
Last date to apply: 20th August 2026.`), { senderMap: {}, clubIndex: [] })[0];
    ok('an explicit closing phrase DOES set the deadline', !!q.payload.deadline, JSON.stringify(q.payload.deadline));
}

console.log('\n── notice body is a summary, not the whole email ──');
{
    const long = `Dear Students,\n\n${'This is a sentence of filler prose about the event. '.repeat(60)}\n\nRegards,\nTeam`;
    const p = IX.runPipeline(email('Some competition', long), { senderMap: {}, clubIndex: [] })[0];
    const body = (p.payload && p.payload.body) || '';
    ok('body capped well under the old 2000 dump', body.length > 0 && body.length <= 900, `len=${body.length}`);
    ok('body does not open with a salutation', !/^dear/i.test(body), body.slice(0, 40));
}

console.log('\n── de-threading thresholds: a thin covering note must not eat the content ──');
{
    const fwd = `Dear all, please see below.\n\nRegards\nHead\n\nOn 1 Aug 2026, at 09:00, Someone <x@iitr.ac.in> wrote:\n\n${'Real announcement content. '.repeat(8)}\nVenue: Convocation Hall\nDate: 12 August 2026`;
    const kept = IX.topMessage(norm(fwd));
    ok('forwarded content survives a thin top', /Convocation Hall/.test(kept), `${kept.length} chars kept`);
    const bigTop = `${'Substantial original content in the covering note. '.repeat(30)}\n\nOn 1 Aug 2026, at 09:00, X <x@iitr.ac.in> wrote:\n\nquoted older thread`;
    ok('a genuinely long top DOES cut the quote', !/quoted older thread/.test(IX.topMessage(norm(bigTop))));
}

console.log('\n── sender authenticity gate (DMARC, via Gmail) ──');
{
    const g = (auth) => IX.passesGates({ ...email('Placement drive', 'Dear Students, register now.'), auth_results: auth });
    ok('genuine: dmarc=pass aligned',
        g('mx.google.com; dkim=pass header.i=@iitr.ac.in; spf=pass; dmarc=pass (p=QUARANTINE) header.from=iitr.ac.in').ok);
    ok('genuine: dkim=pass, spf=none, dmarc=pass (head@iks.iitr.ac.in shape)',
        g('mx.google.com; dkim=pass (test mode) header.i=@iitr.ac.in header.s=iitrselector; spf=none (google.com: does not designate permitted sender hosts) smtp.mailfrom=head@iks.iitr.ac.in; dmarc=pass (p=QUARANTINE sp=QUARANTINE dis=NONE) header.from=iitr.ac.in').ok);
    eq('spoof: dmarc=fail blocked',
        g('mx.google.com; dkim=none; spf=softfail smtp.mailfrom=placement@notices.iitr.ac.in; dmarc=fail header.from=iitr.ac.in').reason, 'gate_spoofed_sender');
    eq('spoof: nothing aligned, no dmarc verdict',
        g('mx.google.com; dkim=none; spf=softfail smtp.mailfrom=placement@notices.iitr.ac.in').reason, 'gate_spoofed_sender');
    eq('spoof: dmarc=pass but attacker domain',
        g('mx.google.com; dkim=pass header.i=@evil.com; spf=pass; dmarc=pass header.from=evil.com').reason, 'gate_spoofed_sender');
    ok('absent verdict is fail-SAFE, not fail-shut', g('').ok);
}

console.log('\n── description survives a "Dear ..." opener (the flattening bug) ──');
{
    const f = IX.extract(email('Expert Talk', `Dear Students,

The Department of Physics is organising an expert talk on quantum materials,
covering recent advances and open problems in the field.

Regards,
Head`));
    ok('description is populated', !!f.description, JSON.stringify(f.description));
    ok('description excludes the salutation', !/dear students/i.test(f.description || ''));
}

console.log('\n── summary is capped at 2 SENTENCES, and abbreviations are not sentence ends ──');
{
    // Found 2026-08-22 auditing live mail: "[^.!?]+[.!?]+" split this ONE sentence into seven, so the
    // two-sentence cap published "…open to all IIT Roorkee B. Tech." — cut mid-clause.
    const summary = 'A Sanskrit verse recitation contest open to all IIT Roorkee B. Tech., M. Tech. & Ph.D. students. Entries close on 28 August.';
    const out = IX.noticeBody(summary, { text: '', details: [] });
    ok('abbreviations do not truncate the summary', /Ph\.D\.\s*students/i.test(out), JSON.stringify(out));
    ok('the whole first sentence survives', /open to all IIT Roorkee B\.\s?Tech/i.test(out), JSON.stringify(out));

    // initials in a speaker name are the same failure mode
    const withInitials = IX.noticeBody('A talk by Prof. S. N. Tandon on space weather. All are welcome.', { text: '', details: [] });
    ok('speaker initials do not truncate', /space weather/i.test(withInitials), JSON.stringify(withInitials));

    // the cap itself must still hold — a genuinely long summary is still trimmed
    const long = IX.noticeBody(`${'This is a real sentence about the workshop. '.repeat(12)}`, { text: '', details: [] });
    ok('two-sentence cap still applies', long.length < 330, `len=${long.length}`);
}

console.log('\n── a complete "Label: value" line must not swallow the next line ──');
{
    // Published as "• Deadline: Saturday, 22nd August EoD In case of any doubts, contact:" — reflow()
    // treated the deadline as a hard-wrapped fragment purely because it has no full stop.
    const { details } = IX.cleanBody('Deadline: Saturday, 22nd August EoD\nIn case of any doubts, contact:');
    ok('deadline stays its own item', details.some((d) => /^Deadline:.*EoD$/i.test(d)),
        JSON.stringify(details));
    ok('the next line is not glued on', !details.some((d) => /EoD In case of/i.test(d)), JSON.stringify(details));

    // a genuinely wrapped long label line must STILL rejoin
    const wrapped = IX.cleanBody('Venue: Alternate Hall on the second floor of the Academic Block near the\nmain library entrance');
    ok('a real wrapped line still rejoins', wrapped.text.includes('main library entrance')
        && /near the main library/i.test(wrapped.text), JSON.stringify(wrapped.text));
}

console.log('\n── audience: a year mentioned for another reason is not an eligibility rule ──');
{
    // The theme list in a contest mail ("1st Year — Fool", "2nd Year — Friend") was being read as the
    // audience, so a contest open to everyone published as "1st Year".
    const themed = IX.extract(email('Sanskrit contest',
        'Open to: B. Tech., M. Tech. & Ph.D. students\nCategories\n1st Year - Fool\n2nd Year - Friend\n3rd Year - Knowledge'));
    ok('a theme list does not set the audience', !themed.audience, JSON.stringify(themed.audience));

    const stated = IX.extract(email('Orientation', 'This session is open only to first year students of the institute.'));
    ok('a stated year eligibility IS captured', /first[-\s]?year/i.test(stated.audience || ''), JSON.stringify(stated.audience));

    const selfEvident = IX.extract(email('Scholarship', 'Applications are invited under the girls only quota for this award.'));
    ok('a self-evident audience needs no cue', /girls only/i.test(selfEvident.audience || ''), JSON.stringify(selfEvident.audience));

    // "FOR ALL EXISTING UG & PG STUDENTS" published as audience "PG STUDENTS" — every UG student was
    // told the academic-registration notice was not theirs. Naming both cohorts means everyone.
    const bothCohorts = IX.extract(email('ACADEMIC REGISTRATION FOR ALL EXISTING UG & PG STUDENTS',
        'Academic registration for all existing UG & PG students will be carried out as per the schedule.'));
    ok('UG & PG together sets no audience badge', !bothCohorts.audience, JSON.stringify(bothCohorts.audience));

    const pgOnly = IX.extract(email('Registration', 'This notice is applicable to PG students only.'));
    ok('PG-only WITH a cue is still captured', /pg students/i.test(pgOnly.audience || ''), JSON.stringify(pgOnly.audience));
}

console.log('\n── a flattened TABLE keeps each row with its own dates ──');
{
    // Gmail renders an HTML table as one cell per line separated by BLANK lines, and reflow() never
    // joins across a blank. The academic-registration notice therefore listed four activities with none
    // of the dates they referred to — the one thing a student needed from it.
    const table = ['SNo.', '', 'Activity', '', 'Date', '',
        '1.', '', 'Fee Payment without late fine', '', 'July 01, 2026 (10:00 AM)', '', 'to', '', 'July 13, 2026 (05:00 PM)', '',
        '2.', '', 'Academic Registration', '', 'July 14, 2026 (09:00 AM)', '', 'to', '', 'July 15, 2026 (05:00 PM)'].join('\n');
    const { details } = IX.cleanBody(table);
    ok('row 1 keeps its dates', details.some((d) => /^1\..*Fee Payment.*July 01, 2026.*July 13, 2026/.test(d)),
        JSON.stringify(details));
    ok('row 2 keeps its dates', details.some((d) => /^2\..*Academic Registration.*July 14, 2026.*July 15, 2026/.test(d)),
        JSON.stringify(details));

    // ...but ordinary prose after a list must NOT be swallowed into the last item
    const prose = ['1. First item', '', '2. Second item', '',
        'Students are required to be physically present on the campus and must visit their respective departments for verification.'].join('\n');
    const p = IX.cleanBody(prose);
    ok('a long paragraph is not merged into the last row',
        !p.details.some((d) => /physically present/.test(d)), JSON.stringify(p.details));

    // a single numbered line is not a table — leave it alone
    const single = IX.cleanBody('1. Only one item\n\nSome following sentence that should stay separate.');
    ok('a lone numbered line is not treated as a table',
        !single.details.some((d) => /following sentence/.test(d)), JSON.stringify(single.details));
}

console.log('\n── the LINK comes from the message, not the sender\'s sign-off ──');
{
    // A Civil Engineering talk published the coordinator's faculty page (sitting in the signature) as
    // the event link, so a student clicking through landed on a staff profile.
    const sig = IX.extract(email('lecture',
        `You are cordially invited for the talk by Dr. Raja Sengupta.
Date: 16 July 2026
Venue: Conference Room, Civil Engg Department

--
Dr. Siddhartha Khare
Assistant Professor
Geomatics Engineering, Dept. of Civil Engineering,
IIT Roorkee, Uttarakhand, India | [ https://civil.iitr.ac.in/CE?Uid=Siddhartha.khare | Webpage ]
Founder @Bhoomicam Pvt. Ltd. startup | [ https://bhoomicam.com/ | Webpage ]`));
    ok('a signature profile link is not used', !sig.link, JSON.stringify(sig.link));

    const real = IX.extract(email('Workshop',
        `Register here: [ https://forms.gle/abc123 | Registration Form ]

Regards
Head | [ https://iitr.ac.in/faculty/x | Webpage ]`));
    ok('a real content link IS used', /forms\.gle\/abc123/.test(real.link || ''), JSON.stringify(real.link));
}

console.log('\n── a quoted email header must not become event detail ──');
{
    // When a whole message is a forward the "-----Original Message-----" marker sits at position 0, so
    // nothing is de-threaded and the header block survived. Its "Date:" line then rendered as a bullet
    // reading "Date: Saturday, 11 July 2026 12:07 AM IST" — the email's SEND time, shown as if it were
    // when the event happens.
    const fwd = ['-----Original Message-----', '',
        'From: Career Development Cell <st_cdc@iitr.ac.in>',
        'To: CDC Office <office_cdc@iitr.ac.in>',
        'Date: Saturday, 11 July 2026 12:07 AM IST',
        'Subject: Interview Preparation Session - Postponement Notice', '',
        'Dear Students,', 'The session has been postponed. The revised date will be shared soon.'].join('\n');
    const { details, text } = IX.cleanBody(fwd);
    ok('the header Date: is not a detail', !details.some((d) => /12:07 AM IST/.test(d)), JSON.stringify(details));
    ok('the actual message survives', /postponed/i.test(text), JSON.stringify(text));

    // a club mail's OWN labels must be untouched — they are not part of a header block
    const club = IX.cleanBody('Fine Arts Club invites all freshers.\nDate: 22 August 2026\nTime: 6:00 PM\nVenue: APJ-205');
    ok('a real "Date:" label is kept', club.details.some((d) => /Date: 22 August 2026/.test(d)), JSON.stringify(club.details));
    ok('a real "Venue:" label is kept', club.details.some((d) => /Venue: APJ-205/.test(d)), JSON.stringify(club.details));
}

console.log('\n── a reminder re-send must not publish a SECOND card ──');
{
    // conversationKey() (runner) dedups on stripSubject(). Only Re:/Fwd:/FW: were stripped, so
    // "Reminder: X" hashed differently from "X". Measured over 45 live mails: the Puppetry show
    // appeared 3x, and the Carbon Nanomaterials lecture, the BFSI workshop and the Fee Payment notice
    // twice each. Note "Remider" — the real typo that shipped from the AAO.
    const key = (s) => IX.stripSubject(s).toLowerCase().replace(/\s+/g, ' ').trim();
    const pairs = [
        ['Financial Literacy Workshop by BFSI on 22nd-Aug-2026', 'Reminder: Financial Literacy Workshop by BFSI on 22nd-Aug-2026'],
        ['Invited lecture on Carbon Nanomaterials', 'Soft Reminder: Invited lecture on Carbon Nanomaterials'],
        ['Experience the Legacy of Indian Puppetry', 'Polite reminder: Experience the Legacy of Indian Puppetry'],
        ['Notification: Fee Payment for Autumn Semester 2026-27', 'Gentle Remider: Notification: Fee Payment for Autumn Semester 2026-27'],
        ['Sangram 2026 Recruitment', 'Fwd: Sangram 2026 Recruitment'],
    ];
    pairs.forEach(([a, b]) => ok(`collapses  ${b.slice(0, 42)}`, key(a) === key(b), `${key(a)} !== ${key(b)}`));

    // a DIFFERENT event must still be its own item
    ok('two different subjects stay distinct',
        key('Reminder: Workshop on LC3') !== key('Reminder: Workshop on Madhubani Art'));
}

console.log('\n── the IMPORTANT band is for consequences, not topics ──');
{
    // Measured 2026-08-22: the old rule pinned 103 of 171 notices (60%) — external hackathons, five
    // near-duplicate quizzes, "Resumption of EBSD Facility" and a football-field closure all outranked
    // fee payment. Pinning everything is the same as pinning nothing.
    const prio = (title, body = 'Some supporting text for the notice.') => {
        const p = IX.noticePayload(email(title, body), {});
        return p.payload.priority;
    };
    ok('fee payment is important', prio('Notification: Fee Payment for Autumn Semester 2026-27') === 'important');
    ok('academic registration is important', prio('ACADEMIC REGISTRATION FOR AUTUMN SEMESTER 2026-27') === 'important');
    ok('an institute holiday is important', prio('Institute Holiday on account of Independence Day') === 'important');
    ok('a library closure is important', prio('MGCL NOTICE - Library will remain closed') === 'important');

    ok('an outside hackathon is NOT important', prio('Digital Shram Sankalp Hackathon: Encouraging Participation') !== 'important');
    ok('an outside quiz is NOT important', prio('National Level Online Quiz for Students of MOU Partners') !== 'important');
    ok('a lab-equipment notice is NOT important', prio('Resumption of EBSD Facility - Monthly Dedicated EBSD Week') !== 'important');
    ok('a football-field closure is NOT important', prio('Closure of football field for maintenance') !== 'important');
    ok('a guest lecture is NOT important', prio('Invited lecture on Carbon Nanomaterials for Electrochemical Applications') !== 'important');
    ok('an activity calendar is NOT important', prio('HEC: Autumn Semester 2026-27 Activity Calendar',
        'The calendar is planned around weekends and holidays so you can plan ahead.') !== 'important');
}

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail ? 1 : 0);
