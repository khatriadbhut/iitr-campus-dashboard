/**
 * The Updates card must show the MERGED item — the reply email's new details over the live event's
 * existing ones. Every case here is the real "Intro to Agentic AI" shape: an original carrying the
 * description and link but no date, and a reply carrying the date but nothing else.
 * Run: node src/utils/updateDraft.test.mjs
 */
import { mergeTargetIntoDraft } from './updateDraft.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};

// the reply email: says the new time and place, nothing else
const reply = {
    title: 'Intro to Agentic AI', club: '', startDate: '2026-08-12', endDate: '',
    timeStart: '18:00', venue: 'APJ 103', link: '', description: '', categories: [], isAllDay: false,
};
// the live event, published from the first email
const live = {
    id: 41, name: 'Intro to Agentic AI', start: '2026-08-10T12:30:00.000Z',
    description: 'An introductory session on Agentic AI for freshers.',
    venue_text: 'TBA', registration_link: 'https://instagram.com/stc.iitr',
    club_name: 'SDSLabs (Software Development Section)', categories: ['Talks & Lectures'],
};

const m = mergeTargetIntoDraft(reply, live);

ok('the reply WINS on what it stated (venue)', m.venue === 'APJ 103', m.venue);
ok('the reply WINS on what it stated (date)', m.startDate === '2026-08-12', m.startDate);
ok('the live event fills the description', /introductory session/.test(m.description), m.description);
ok('the live event fills the link', /instagram/.test(m.link), m.link);
ok('the live event fills the club', /SDSLabs/.test(m.club), m.club);
ok('the live event fills the categories', m.categories.join() === 'Talks & Lectures', JSON.stringify(m.categories));

// a reply that names its own categories keeps them
const m2 = mergeTargetIntoDraft({ ...reply, categories: ['Workshops & Courses'] }, live);
ok('the reply keeps its own categories', m2.categories.join() === 'Workshops & Courses', JSON.stringify(m2.categories));

// the whole point: a reschedule must not be undone by the value it came to correct
const m3 = mergeTargetIntoDraft({ ...reply, timeStart: '17:30' }, { ...live, start: '2026-08-12T12:30:00.000Z' });
ok('a corrected time is never overwritten by the live one', m3.timeStart === '17:30', m3.timeStart);

// nothing selected yet → unchanged
ok('no target leaves the draft alone', mergeTargetIntoDraft(reply, null) === reply);

// an empty string on the live side must not blank a real value
const m4 = mergeTargetIntoDraft({ ...reply, venue: '' }, { ...live, venue_text: null });
ok('a missing value on both sides becomes empty, not undefined', m4.venue === '', JSON.stringify(m4.venue));

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail ? 1 : 0);
