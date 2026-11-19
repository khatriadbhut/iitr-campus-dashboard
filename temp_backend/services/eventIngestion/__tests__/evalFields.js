/**
 * FIELD-level extraction accuracy (the report card for date/time/venue — complements evalAccuracy.js
 * which only scores TYPE). Scores the deterministic extractor vs the Groq-merged output against
 * HUMAN-labeled real emails, per field. Run BEFORE editing the extraction prompt/regex to catch
 * field regressions; also watch /drift's edit_rate live.
 * Run: node services/eventIngestion/__tests__/evalFields.js   (needs GMAIL_* + GROQ; labels have no PII.)
 *
 * date/time = exact match; venue = extracted contains the labeled substring (venues are freeform).
 */
require('dotenv').config();
const gmail = require('../source/gmail');
const groq = require('../review/groq');
const { extract, mergeFields, topMessage } = require('../index');

// gmail message-id → the correct fields (hand-labeled from the email body; null = not labeled/scored)
const LABELS = {
  '19f99420eaebc793': { date: '2026-07-28' },
  '19f943cdbf654021': { date: '2026-08-04', time: '18:15' },
  '19f8b443b76d9841': { date: '2026-07-24', time: '20:00', venue: 'Online' },
  '19f88409ff82f951': { date: '2026-07-22', time: '16:00', venue: 'Lecture Theatre' },
  '19f84795bfdbcc0b': { venue: 'Parliament Library Building' },
  '19f842dd32e34e96': { date: '2026-07-31' },
  '19f8388512ade149': { date: '2026-07-27' },
  '19f715e094f42dbe': { time: '06:30' },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const score = (label, payload, f) => {
  if (label[f] == null) return null;
  const got = f === 'date' ? payload.startDate : f === 'time' ? payload.time_start : payload.venue;
  if (f === 'venue') return (got && got.toLowerCase().includes(label[f].toLowerCase())) ? 1 : 0;
  return got === label[f] ? 1 : 0;
};

(async () => {
  const det = { date: [0, 0], time: [0, 0], venue: [0, 0] };
  const mrg = { date: [0, 0], time: [0, 0], venue: [0, 0] };
  const misses = [];
  for (const [id, label] of Object.entries(LABELS)) {
    let e; try { e = gmail.normalizeMessage(await gmail.getMessage(id)); } catch { continue; }
    const detFields = extract(e);
    let g = null;
    if (groq.isConfigured()) { g = await groq.classifyEmail({ subject: e.subject, text: topMessage(e.body_text), sender: e.from, sentDate: e.internal_date }); await sleep(1200); }
    const merged = mergeFields(detFields, g && g.fields, `${e.subject || ''}\n${e.body_text || ''}`, e.internal_date).payload;
    for (const f of ['date', 'time', 'venue']) {
      const sd = score(label, detFields, f); if (sd != null) { det[f][0] += sd; det[f][1] += 1; }
      const sm = score(label, merged, f); if (sm != null) { mrg[f][0] += sm; mrg[f][1] += 1; if (sm === 0) misses.push(`${f}: want ${label[f]} got ${f === 'date' ? merged.startDate : f === 'time' ? merged.time_start : merged.venue} | ${(e.subject || '').slice(0, 40)}`); }
    }
  }
  const pct = (a) => a[1] ? `${a[0]}/${a[1]} (${Math.round(100 * a[0] / a[1])}%)` : '—';
  console.log(`\n=== field accuracy (model ${groq.MODEL}, ${groq.isConfigured() ? 'groq live' : 'groq off'}) ===`);
  console.log(`             deterministic      merged(groq)`);
  for (const f of ['date', 'time', 'venue']) console.log(`  ${f.padEnd(6)}     ${pct(det[f]).padEnd(18)} ${pct(mrg[f])}`);
  console.log(`\nmerged misses:`); misses.forEach((m) => console.log('  ' + m));
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
