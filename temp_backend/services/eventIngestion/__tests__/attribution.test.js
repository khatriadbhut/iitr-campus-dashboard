/**
 * Club attribution regressions. Every fixture is taken from real student-notices mail measured over a
 * year — nothing invented. The rules these lock down were each derived from a specific failure:
 * see memory club-attribution-plan.
 *
 * From temp_backend/: node services/eventIngestion/__tests__/attribution.test.js
 */
const { attribute } = require('./../index');
const CFG = require('./../institutions/iitr.config');

const CLUBS = [
    ['Himalayan Explorers Club', 'hec@iitr.ac.in'], ['Think India', 'tic@iitr.ac.in'],
    ['E-Cell', 'ecell@iitr.ac.in'], ['Sanskrit Club', 'sanskrit@iitr.ac.in'],
    ['InfoSec', 'infosec@iitr.ac.in'], ['Esports IITR', 'esports@iitr.ac.in'],
    ['BlocSoc IITR', 'blocsoc@iitr.ac.in'], ['ArIES', 'aries@iitr.ac.in'],
    ['Cinema Club', 'cinemaclub@iitr.ac.in'], ['Music Section', 'musicsection@iitr.ac.in'],
    ['Cognizance', 'cognizance@iitr.ac.in'], ['ShARE', 'share@iitr.ac.in'],
    ['Fine Arts', 'finearts@iitr.ac.in'], ['Wellness IITR', 'wellness@iitr.ac.in'],
    ['Thomso', 'thomso@iitr.ac.in'], ['Finance Club', 'financeclub@iitr.ac.in'],
    ['STC (Students’ Technical Council)', 'stc@iitr.ac.in'],
    ['Cultural Council', 'gensec.cult@iitr.ac.in'],          // a RELAY, deliberately
    ['SAC(Student Affairs Council)', 'sac@iitr.ac.in'],
    ['Photography Club', 'photog@iitr.ac.in'], ['Institute', 'institute@iitr.ac.in'],
];
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim();
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/iitr?$/, '');
const clubIndex = (() => {
    const aliases = [], byEmail = new Map(), bySquash = new Map();
    for (const [name, email] of CLUBS) {
        const al = new Set([name]);
        const m = /^([^(]+?)\s*\(([^)]+)\)\s*$/.exec(name);
        if (m) { al.add(m[1].trim()); al.add(m[2].trim()); }
        for (const a of [...al]) al.add(a.replace(/\s*IITR?$/i, '').trim());
        for (const a of (CFG.clubAliases || {})[name] || []) al.add(a);
        for (const a of al) {
            const x = norm(a); if (x.length >= 3) aliases.push([x, name]);
            const sq = squash(a); if (sq.length >= 3 && !bySquash.has(sq)) bySquash.set(sq, name);
        }
        if (email && !CFG.relaySenders.includes(email)) byEmail.set(email, name);
    }
    aliases.sort((a, b) => b[0].length - a[0].length);
    return { aliases, byEmail, bySquash };
})();

let pass = 0, fail = 0;
const t = (label, email, wantClub, wantVia) => {
    const r = attribute(email, {}, clubIndex);
    const ok = r.club === wantClub && (!wantVia || r.via === wantVia);
    if (ok) { pass++; console.log(`✅ ${label}`); }
    else { fail++; console.log(`❌ ${label}\n     got  ${r.club} (${r.via})\n     want ${wantClub}${wantVia ? ` (${wantVia})` : ''}`); }
};
const E = (from, subject, body) => ({ from, subject, body_text: body || '' });
// Same, but with an admin-taught sender map in play — the only way to exercise the relay ordering.
const ts = (label, senderMap, email, wantClub, wantVia) => {
    const r = attribute(email, senderMap, clubIndex);
    const ok = r.club === wantClub && (!wantVia || r.via === wantVia);
    if (ok) { pass++; console.log(`✅ ${label}`); }
    else { fail++; console.log(`❌ ${label}\n     got  ${r.club} (${r.via})\n     want ${wantClub}${wantVia ? ` (${wantVia})` : ''}`); }
};

// ── the club's own address: exact, and the reason 24% of mail needs no text at all ───────────────
t('club email wins outright', E('tic@iitr.ac.in', 'Updated Route For Tiranga Yatra 2026'), 'Think India', 'club_email');
t('address beats an empty subject', E('hec@iitr.ac.in', 'Registration for Yulla Kanda Trek'), 'Himalayan Explorers Club', 'club_email');
t('display name around the address', E('"Sanskrit club" <sanskrit@iitr.ac.in>', 'Video Making Competition'), 'Sanskrit Club', 'club_email');
// A RELAY address is stored against Cultural Council but forwards for everyone — it must never attribute.
t('relay address does NOT attribute', E('gensec.cult@iitr.ac.in', 'Some forwarded notice'), 'Institute', 'fallback');

// ── subject ──────────────────────────────────────────────────────────────────────────────────────
t('club named in the subject', E('fa.culsoc@iitr.ac.in', 'FW: Music Section Open Mic | Registrations Open'), 'Music Section', 'subject');
t('alias in the subject', E('fa.culsoc@iitr.ac.in', 'FW: Photog | Intro Talk + Workshop'), 'Photography Club', 'subject');
t('umbrella body IS allowed from the subject', E('adii@iitr.ac.in', 'Invitation to STC Tech Exhibition || 23 Aug'), 'STC (Students’ Technical Council)', 'subject');

// ── sign-off, above the forwarder's block ────────────────────────────────────────────────────────
t('club signs off above the delimiter', E('gensec-sports@iitr.ac.in', 'Fwd: Arcade Kaishi – Gaming Event',
    'Compete and win prizes.\n\nRegards,\nEsports IITR\n\n---\nThanks & Regards,\nRajarshi Verma\nDeputy General Secretary Technical Affairs\nInstagram https://www.instagram.com/stc.iitr/'),
    'Esports IITR', 'signoff');
t('glued name in the sign-off', E('gensec.technical@iitr.ac.in', 'Hands on Software Exploitation',
    'Join us.\n\nRegards,\nTeam InfoSecIITR\n+919000000001\n\n---\nThanks & Regards,\nRajarshi Verma\nInstagram https://www.instagram.com/stc.iitr/'),
    'InfoSec', 'signoff');
// THE trap: the forwarder's own signature is the same council on 101 emails a year.
t('forwarder signature must NOT win', E('gensec.technical@iitr.ac.in', 'Some third-party competition',
    'An external contest, no club involved.\n\n--\nThanks & Regards,\nAviral Vishwakarma\nGeneral Secretary Technical Affairs\nIIT Roorkee\nInstagram https://www.instagram.com/stc.iitr/'),
    'Institute', 'fallback');
t('two-dash delimiter works too', E('gensec.technical@iitr.ac.in', 'NFO 6.0 B-School Batch',
    'Shape the future of finance.\n\nBest regards,\nFinance Club, IIT R.\n\n--\nThanks & Regards,\nAviral Vishwakarma\nInstagram https://www.instagram.com/stc.iitr/'),
    'Finance Club', 'signoff');

// ── body: organiser cue required ─────────────────────────────────────────────────────────────────
t('"X is here to..." counts', E('gensec.technical@iitr.ac.in', 'Invitation | Introduction to Blockchain',
    'Ever heard of Web3? BlocSoc IITR is here to decode them all! Venue: APJ-AKB 405'), 'BlocSoc IITR', 'body');
t('"the X Workshop Series" counts', E('gensec.technical@iitr.ac.in', 'Invitation: Workshop on Introduction to AI',
    'We are happy to invite you to an interactive workshop of the ArIES Workshop Series!'), 'ArIES', 'body');
// Each of these was a REAL false positive before the organiser cue was required.
t('"take cognizance of" is not Cognizance', E('head@ce.iitr.ac.in', 'Fwd: Workshop on Net-Zero Carbon',
    'Gentle reminder, please take cognizance of the trailing mail on the captioned subject.'), 'Institute', 'fallback');
t('"students from fine arts" is a field of study', E('adoswsa@iitr.ac.in', 'Fwd: Invitation for creative ideas',
    'Students particularly from fine arts, design, architecture and other creative disciplines may apply.'), 'Institute', 'fallback');
t('Thomso as a calendar date is not Thomso', E('donotreply-acad@iitr.ac.in', 'Revised Academic Calendar',
    'Autumn semester dates revised. Thomso: 24-26 October. Mid-term exams follow.'), 'Institute', 'fallback');
t('"wellness" the word is not Wellness IITR', E('adoswsw@iitr.ac.in', 'Financial Assistance for Needy UG Students',
    'Applications invited for financial assistance to support student wellness and welfare.'), 'Institute', 'fallback');
t('"pleased to share" is not ShARE', E('library@iitr.ac.in', 'National Space Day resources',
    'MGCL is pleased to share a curated collection of resources on space science.'), 'Institute', 'fallback');
t('umbrella body NOT taken from a passing body mention', E('gensec.technical@iitr.ac.in', 'HELIOS is Open for Recruitment',
    'HELIOS is a newly established technical club under the Students Technical Council (STC).'), 'Institute', 'fallback');

// ── genuinely no club ────────────────────────────────────────────────────────────────────────────
t('external competition stays Institute', E('gensec.pgacads@iitr.ac.in', 'Fwd: WorldSkills Competition 2026',
    'Details sought for letter of invitation from the national skills body.'), 'Institute', 'fallback');
t('institute office stays Institute', E('awards@iitr.ac.in', 'Provisional list of Tuition Fee Waiver'), 'Institute', 'fallback');
t('empty email does not crash', E('', ''), 'Institute', 'fallback');

// ── the sender map must not shadow the text ON A RELAY ───────────────────────────────────────────
// gensec.cult@ is BOTH a relay and an admin-taught sender_entity_map row (→ Cultural Council). While
// the map was consulted before the subject, every cultural club it forwarded for collapsed into the
// council: measured over a year, 18 of the 39 mails it claimed named the real club in the subject.
const CULT = { 'gensec.cult@iitr.ac.in': 'Cultural Council' };
ts('relay map does NOT shadow the subject', CULT,
    E('gensec.cult@iitr.ac.in', 'Fwd: Fine Arts IIT Roorkee presents DARPAN 2026!!'), 'Fine Arts', 'subject');
ts('relay map does NOT shadow the sign-off', CULT,
    E('gensec.cult@iitr.ac.in', 'Invitation to a session',
        'Shape the future of finance.\n\nBest regards,\nFinance Club, IIT R.\n\n--\nThanks,\nGeneral Secretary Cultural Affairs'),
    'Finance Club', 'signoff');
// ...but it is still the best answer when the text names nobody — better than Institute for a council
// that only forwards its own domain's mail.
ts('relay map IS the fallback when the text is silent', CULT,
    E('gensec.cult@iitr.ac.in', 'Reminder about tomorrow'), 'Cultural Council', 'sender_relay');
// A NON-relay map row is a deliberate admin teaching and must still outrank the text.
ts('non-relay map still wins over the subject', { 'adci@iitr.ac.in': 'Photography Club' },
    E('adci@iitr.ac.in', 'Fwd: Fine Arts IIT Roorkee presents DARPAN 2026!!'), 'Photography Club', 'sender');


// ── a club's own address sitting in Cc ───────────────────────────────────────────────────────────
// A club routinely broadcasts through a relay and copies itself, so From is the forwarder and the club
// appears nowhere but the Cc line — cinesec@iitr.ac.in reaches students exactly that way. The pipeline
// never fetched Cc at all, so such a club could only ever come out as Institute.
{
    const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim();
    const squash = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/iitr?$/, '');
    const CLUBS = [['Cinema Club', 'cinemaclub@iitr.ac.in'], ['CineSec Cinematics Section IITR', 'cinesec@iitr.ac.in']];
    const aliases = []; const byEmail = new Map(); const bySquash = new Map();
    for (const [name, email] of CLUBS) {
        for (const a of new Set([name, name.replace(/\s*IITR?$/i, '').trim()])) {
            if (norm(a).length >= 3) aliases.push([norm(a), name]);
            const sq = squash(a); if (sq.length >= 3 && !bySquash.has(sq)) bySquash.set(sq, name);
        }
        byEmail.set(email, name);
    }
    aliases.sort((a, b) => b[0].length - a[0].length);
    const ci = { aliases, byEmail, bySquash };
    const sm = { 'gensec.cult@iitr.ac.in': 'Cultural Council' };
    const relay = CFG.relaySenders[0];

    const cc = (label, email, wantClub, wantVia) => {
        const r = attribute(email, sm, ci);
        const ok = r.club === wantClub && (!wantVia || r.via === wantVia);
        if (ok) { pass++; console.log(`✅ ${label}`); }
        else { fail++; console.log(`❌ ${label}\n     got  ${r.club} (${r.via})\n     want ${wantClub}${wantVia ? ` (${wantVia})` : ''}`); }
    };

    cc('a club in Cc is used when From is only the relay',
        { from: `<${relay}>`, cc: 'cinesec@iitr.ac.in', subject: 'Screening tonight', body_text: 'Come along.' },
        'CineSec Cinematics Section IITR', 'cc');
    cc('a club mailing directly beats a different club in Cc',
        { from: 'Cinema Club <cinemaclub@iitr.ac.in>', cc: 'cinesec@iitr.ac.in', subject: 'Screening', body_text: 'x' },
        'Cinema Club', 'club_email');
    cc('a subject naming the organiser beats Cc',
        { from: `<${relay}>`, cc: 'cinesec@iitr.ac.in', subject: 'Cinema Club Screening : Main Vaapas Aaunga', body_text: 'x' },
        'Cinema Club', 'subject');
    cc('TWO clubs in Cc says nothing about who runs it, so it is refused',
        { from: `<${relay}>`, cc: 'cinesec@iitr.ac.in, cinemaclub@iitr.ac.in', subject: 'Joint notice', body_text: 'x' },
        'Institute', 'fallback');
    cc('a relay copied on its own broadcast is not the organiser',
        { from: `<${relay}>`, cc: relay, subject: 'Notice', body_text: 'x' }, 'Institute', 'fallback');
    cc('no Cc header behaves exactly as before',
        { from: `<${relay}>`, subject: 'Notice', body_text: 'x' }, 'Institute', 'fallback');
}

console.log(`\n${pass}/${pass + fail} passed.`);
if (fail) process.exit(1);
