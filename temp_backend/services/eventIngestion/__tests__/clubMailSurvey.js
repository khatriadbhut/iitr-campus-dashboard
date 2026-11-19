/**
 * GROUND TRUTH survey: dump real club mail (subject + a short cleaned body snippet) so a human can
 * judge what each item actually IS — event / opportunity / notice — independently of the classifier.
 * Deliberately does NOT call Groq: the question is what the RIGHT answer is, not what the model said.
 * Club senders come from sender_entity_map (populated from production) plus the two gensec relays.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const gmail = require('../source/gmail');
const { passesGates, stripSubject, cleanBody, topMessage, extract } = require('../index');
const { SenderEntityMap, Club } = require('../../../database/schemas');

const N = Number(process.argv[2]) || 180;
const OUT = process.argv[3] || '/private/tmp/claude-501/-Users-adbhut-Campus-Dashboard-Event-Planner/ac91cb0a-d57e-4d6a-a4d7-84f3a9d57247/scratchpad/clubmail.json';
const LISTS = 'to:students-notices@iitr.ac.in OR to:ug@iitr.ac.in OR to:pg@iitr.ac.in OR to:ug-1st-year@iitr.ac.in';

const pool = async (items, n, worker) => {
  let i = 0;
  const run = async () => { while (i < items.length) { const idx = i++; try { await worker(items[idx], idx); } catch (e) {} } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
};

(async () => {
  const rows = await SenderEntityMap.findAll({ include: [{ model: Club, attributes: ['name'] }] });
  const senders = new Set(rows.map((r) => r.match_value).filter(Boolean));
  ['gensec.technical@iitr.ac.in','gensec.cult@iitr.ac.in','gensec.pgacads@iitr.ac.in','gensec-sports@iitr.ac.in',
   'gensec.hostel@iitr.ac.in','gensec.ughostel@iitr.ac.in','sports@iitr.ac.in','thomso@iitr.ac.in','sangram@iitr.ac.in',
   'cognizance@iitr.ac.in','srishti@iitr.ac.in','guptafcc@iitr.ac.in','cig@iitr.ac.in','adci@iitr.ac.in'].forEach((s) => senders.add(s));
  const q = `(${[...senders].map((s) => `from:${s}`).join(' OR ')}) (${LISTS}) newer_than:400d`;

  const ids = await gmail.listMessageIds({ query: q, max: 500 });
  console.log(`club senders: ${senders.size} | matching mails: ${ids.length}`);

  const out = [];
  await pool(ids, 6, async (id) => {
    if (out.length >= N) return;
    const full = await gmail.getMessage(id);
    if (!full) return;
    const e = gmail.normalizeMessage(full);
    if (!passesGates(e).ok) return;
    const cleaned = cleanBody(topMessage(e.body_text));
    const f = extract(e);
    out.push({
      from: (e.from || '').replace(/.*<|>.*/g, ''),
      subject: stripSubject(e.subject).replace(/\s+/g, ' ').slice(0, 95),
      date: f.startDate || null, time: f.time_start || null, venue: f.venue || null,
      deadline: f.registration_deadline || null,
      snippet: cleaned.text.replace(/\s+/g, ' ').slice(0, 170),
    });
  });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`captured ${out.length} club emails → ${OUT}`);
  process.exit(0);
})();
