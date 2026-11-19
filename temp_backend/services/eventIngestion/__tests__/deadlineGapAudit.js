/**
 * How often does the pipeline FAIL to read a deadline the email plainly states?
 *
 * Runs on FULL bodies (an earlier pass used 170-char snippets and undercounted badly). No LLM: this
 * measures the deterministic extractor, which is what fills `deadline` on every proposal regardless
 * of who classified it. Reports the miss rate and groups misses by cause so the fix is structural
 * rather than per-email.
 */
require('dotenv').config({ quiet: true });
const gmail = require('../source/gmail');
const { passesGates, extract, stripSubject, topMessage } = require('../index');
const { SenderEntityMap } = require('../../../database/schemas');

const N = Number(process.argv[2]) || 180;
const LISTS = 'to:students-notices@iitr.ac.in OR to:ug@iitr.ac.in OR to:pg@iitr.ac.in OR to:ug-1st-year@iitr.ac.in';
const DEADLINE_PHRASE = /last date|deadline|apply by|register by|submit by|closes on|last day|due by|on or before/i;
// characters that silently defeat \d and (st|nd|rd|th): superscript ordinals, fullwidth digits, NBSP
const WEIRD = /[ªºʰ-˿ᴬ-ᵪ⁰-₟０-９ ]/;

const pool = async (items, n, worker) => {
  let i = 0;
  const run = async () => { while (i < items.length) { const idx = i++; try { await worker(items[idx]); } catch (e) {} } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
};

(async () => {
  const rows = await SenderEntityMap.findAll({ attributes: ['match_value'], raw: true });
  const senders = new Set(rows.map((r) => r.match_value).filter(Boolean));
  ['gensec.technical', 'gensec.cult', 'gensec.pgacads', 'gensec-sports', 'gensec.hostel', 'gensec.ughostel',
   'sports', 'thomso', 'sangram', 'guptafcc', 'cig', 'adci'].forEach((s) => senders.add(`${s}@iitr.ac.in`));
  const q = `(${[...senders].map((s) => `from:${s}`).join(' OR ')}) (${LISTS}) newer_than:400d`;

  const ids = await gmail.listMessageIds({ query: q, max: 500 });
  const out = { seen: 0, stated: 0, missed: 0, weird: 0, weirdMissed: 0, misses: [] };
  await pool(ids, 6, async (id) => {
    if (out.seen >= N) return;
    const full = await gmail.getMessage(id);
    if (!full) return;
    const e = gmail.normalizeMessage(full);
    if (!passesGates(e).ok) return;
    out.seen++;
    const body = `${stripSubject(e.subject)}\n${topMessage(e.body_text)}`;
    const hasWeird = WEIRD.test(body);
    if (hasWeird) out.weird++;
    if (!DEADLINE_PHRASE.test(body)) return;
    out.stated++;
    const f = extract(e);
    if (!f.registration_deadline) {
      out.missed++;
      if (hasWeird) out.weirdMissed++;
      // capture the sentence that states the deadline, to classify the cause
      const m = new RegExp(`.{0,70}(?:${DEADLINE_PHRASE.source}).{0,60}`, 'i').exec(body);
      if (out.misses.length < 30) out.misses.push({ from: (e.from || '').replace(/.*<|>.*/g, ''), line: (m ? m[0] : '').replace(/\s+/g, ' ').trim().slice(0, 110), weird: hasWeird });
    }
  });

  console.log(`emails examined (full body): ${out.seen}`);
  console.log(`  state a deadline phrase   : ${out.stated}`);
  console.log(`  deadline NOT extracted    : ${out.missed}  → ${Math.round(out.missed / out.stated * 100)}% miss rate`);
  console.log(`  contain unicode oddities  : ${out.weird} (of which missed a deadline: ${out.weirdMissed})`);
  console.log('\n--- the sentences we failed to read ---');
  out.misses.forEach((m) => console.log(`  [${m.weird ? 'unicode' : '       '}] ${m.from.split('@')[0].slice(0,14).padEnd(15)} ${m.line}`));
  process.exit(0);
})();
