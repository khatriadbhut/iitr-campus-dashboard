/**
 * What do the MUTED senders actually send?
 *
 * denySenders is a blanket mute, softened only by a keyword rescue (positiveSignals). Anything that is
 * a genuine student event but uses none of those words is lost silently — "Celebration of Independence
 * Day Function" is the case that surfaced. This dumps a year of their mail with a verdict for each
 * (dropped / rescued) so the list can be decided from evidence rather than assumption. Gmail only, no LLM.
 */
require('dotenv').config({ quiet: true });
const gmail = require('../source/gmail');
const CFG = require('../institutions/iitr.config');
const fs = require('fs');
const { stripSubject, addr, topMessage } = require('../index');

const LISTS = 'to:students-notices@iitr.ac.in OR to:ug@iitr.ac.in OR to:pg@iitr.ac.in OR to:ug-1st-year@iitr.ac.in';
const pool = async (items, n, worker) => {
  let i = 0;
  const run = async () => { while (i < items.length) { const idx = i++; try { await worker(items[idx]); } catch (e) {} } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
};

(async () => {
  const q = `(${CFG.denySenders.map((s) => `from:${s}`).join(' OR ')}) (${LISTS}) newer_than:365d`;
  const ids = await gmail.listMessageIds({ query: q, max: 400 });
  console.log(`muted senders: ${CFG.denySenders.length} | their mail in the last year: ${ids.length}\n`);

  const rows = [];
  await pool(ids, 6, async (id) => {
    const full = await gmail.getMessage(id);
    if (!full) return;
    const e = gmail.normalizeMessage(full);
    const subj = stripSubject(e.subject);
    const blob = `${subj}\n${topMessage(e.body_text) || ''}`;
    rows.push({
      from: addr(e.from).split('@')[0],
      subject: subj.replace(/\s+/g, ' ').slice(0, 74),
      rescued: CFG.positiveSignals.test(blob),
      hardDeny: (CFG.denySubjectsHard || []).some((re) => re.test(subj)),
      sensitive: CFG.sensitiveContent.test(blob),
    });
  });

  const bySender = {};
  rows.forEach((r) => { (bySender[r.from] = bySender[r.from] || []).push(r); });
  for (const [s, rs] of Object.entries(bySender).sort((a, b) => b[1].length - a[1].length)) {
    const dropped = rs.filter((r) => !r.rescued && !r.sensitive && !r.hardDeny);
    console.log(`\n===== ${s}  (${rs.length} mails | ${rs.length - dropped.length} rescued/blocked, ${dropped.length} SILENTLY DROPPED) =====`);
    dropped.slice(0, 14).forEach((r) => console.log('   ', r.subject));
  }
  fs.writeFileSync('/private/tmp/claude-501/-Users-adbhut-Campus-Dashboard-Event-Planner/ac91cb0a-d57e-4d6a-a4d7-84f3a9d57247/scratchpad/muted.json', JSON.stringify(rows, null, 1));
  console.log(`\nTOTAL: ${rows.length} | silently dropped: ${rows.filter((r) => !r.rescued && !r.sensitive && !r.hardDeny).length}`);
  process.exit(0);
})();
