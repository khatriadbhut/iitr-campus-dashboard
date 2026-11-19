/**
 * How often do an email's DETAILS arrive in a later message of the same conversation?
 *
 * Groups real mail into conversations (thread id, plus a subject key that strips Re:/Fwd: wherever
 * they appear — campus senders bury them mid-subject). Then finds chains whose FIRST message has no
 * date/time/venue but a LATER one does: exactly the population that would need a notice→event
 * conversion. No LLM — this measures the deterministic extractor, which is what fills these fields
 * on every proposal regardless of who classified it.
 */
require('dotenv').config({ quiet: true });
const gmail = require('../source/gmail');
const { passesGates, extract, stripSubject } = require('../index');

const N = Number(process.argv[2]) || 250;
const LISTS = 'to:students-notices@iitr.ac.in OR to:ug@iitr.ac.in OR to:pg@iitr.ac.in OR to:ug-1st-year@iitr.ac.in';

// strip Re:/Fwd:/FW: and any "SOMETHING----" preamble ANYWHERE, then keep the tail
const norm = (s) => {
    let t = String(s || '');
    for (let i = 0; i < 6; i++) t = t.replace(/^.*?\b(?:re|fwd|fw)\s*:\s*/i, '');
    return t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
};

const pool = async (items, n, worker) => {
    let i = 0;
    const run = async () => { while (i < items.length) { const idx = i++; try { await worker(items[idx]); } catch (e) {} } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
};

(async () => {
    const ids = await gmail.listMessageIds({ query: `(${LISTS}) newer_than:400d`, max: 500 });
    const msgs = [];
    await pool(ids.slice(0, N), 6, async (id) => {
        const full = await gmail.getMessage(id);
        if (!full) return;
        const e = gmail.normalizeMessage(full);
        if (!passesGates(e).ok) return;
        const f = extract(e);
        msgs.push({
            thread: e.thread_id, key: norm(e.subject), when: new Date(e.internal_date).getTime(),
            subject: stripSubject(e.subject).replace(/\s+/g, ' ').slice(0, 62),
            from: (e.from || '').replace(/.*<|>.*/g, ''),
            date: f.startDate, time: f.time_start, venue: f.venue,
            link: f.registration_link || f.link, deadline: f.registration_deadline,
        });
    });

    // group by subject key (catches senders who start new threads), fall back to thread id
    const groups = {};
    msgs.forEach((m) => { const k = m.key.length > 12 ? m.key : `t:${m.thread}`; (groups[k] = groups[k] || []).push(m); });
    const chains = Object.values(groups).filter((g) => g.length > 1).map((g) => g.sort((a, b) => a.when - b.when));

    const lateSchedule = [], lateLink = [];
    for (const g of chains) {
        const first = g[0];
        const firstScheduled = !!(first.date || first.venue);
        const laterScheduled = g.slice(1).find((m) => m.date || m.venue);
        if (!firstScheduled && laterScheduled) lateSchedule.push([first, laterScheduled]);
        const laterLink = g.slice(1).find((m) => m.link && !first.link);
        if (laterLink) lateLink.push([first, laterLink]);
    }

    console.log(`messages examined: ${msgs.length} | conversations with >1 message: ${chains.length}`);
    console.log(`\nDETAILS ARRIVED LATE (first msg had no date/venue, a later one did): ${lateSchedule.length}`);
    lateSchedule.forEach(([a, b]) => console.log(`   ${a.from.split('@')[0].slice(0,14).padEnd(15)} ${a.subject.slice(0,52)}\n      → later: date=${b.date||'—'} time=${b.time||'—'} venue=${b.venue||'—'}`));
    console.log(`\nLINK ARRIVED LATE (first msg had no link, a later one did): ${lateLink.length}`);
    lateLink.forEach(([a, b]) => console.log(`   ${a.from.split('@')[0].slice(0,14).padEnd(15)} ${a.subject.slice(0,52)}`));
    process.exit(0);
})();
