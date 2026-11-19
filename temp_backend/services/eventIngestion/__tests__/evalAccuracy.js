/**
 * Groq classification accuracy benchmark (the "don't break the good ones" guard for the LLM layer).
 * Run this BEFORE editing the Groq prompt: it scores Groq-70b + the deterministic pipeline against a
 * fixed set of HUMAN-LABELED real broadcasts and prints accuracy + which cases FLIPPED since last run.
 * A per-case veto would be unsound (Groq is non-deterministic / model IDs get deprecated), so this is a
 * scored report a human reads — not an automatic gate.
 *
 * Labels are gmail message-ids → correct type (no bodies here — fetched live from Gmail, so no PII in git).
 * Run: node services/eventIngestion/__tests__/evalAccuracy.js   (needs GMAIL_* env; grow LABELS from real corrections.)
 */
require('dotenv').config();
const gmail = require('../source/gmail');
const groq = require('../review/groq');
const { runPipeline, passesGates } = require('../index');

// human-labeled ground truth (intent: attend=event, apply-by=opportunity, inform=notice, day-status=calendar, roster/noise=dismiss)
const LABELS = {
  '19e27d387dd3d973': 'notice', '19e26aa0b3ce4c84': 'opportunity', '19e2559726b119b7': 'opportunity', '19e22279db0bc328': 'opportunity',
  '19e21c596409f70b': 'event', '19e2173b5d580038': 'opportunity', '19e21728f16f0c0f': 'opportunity', '19e2041ef50a5508': 'dismiss',
  '19e20286a457da08': 'dismiss', '19e1fc12ceeb7643': 'event', '19e1f58cd160f757': 'event', '19e1c1c8e56fd6f4': 'event',
  '19e1b93274dcf04b': 'notice', '19e17457116fb648': 'opportunity', '19e170e57e114129': 'notice', '19e16334d50cb39d': 'event',
  '19e15e2061cdc24d': 'dismiss', '19e15cb691aad10e': 'notice', '19e15178947f6b6c': 'event', '19e1056b696f2a72': 'opportunity',
  '19e0cf5f1e2a8c3c': 'event', '19e092ca47d5fa2c': 'opportunity', '19e08d74b9d8a910': 'event', '19e077fda1923684': 'event',
  '19e061621b8fd84c': 'notice', '19e040ea85c6fd71': 'opportunity', '19dfc0d43e379ae6': 'dismiss', '19df86242576ddb7': 'notice',
  '19df71e229dcfe6f': 'opportunity', '19df6e39be080588': 'opportunity', '19df34d2a6126e7a': 'opportunity', '19deb6095b2cf513': 'opportunity',
  '19de9792decaf17c': 'dismiss', '19de115dba67bc3e': 'opportunity', '19ddf6b2970ab369': 'event',
};
const detType = (p) => p.mutation_type === 'CREATE_EVENT' ? 'event' : p.mutation_type === 'CALENDAR_ENTRY' ? 'calendar' : p.mutation_type === 'DISMISS' ? 'dismiss' : (p.payload && p.payload.is_opportunity ? 'opportunity' : 'notice');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!gmail.isConfigured()) { console.log('GMAIL_* not configured — cannot fetch the labeled corpus.'); process.exit(0); }
  const ids = Object.keys(LABELS);
  let detOk = 0, gOk = 0, gNull = 0, n = 0;
  const gMiss = [];
  for (const id of ids) {
    let e; try { e = gmail.normalizeMessage(await gmail.getMessage(id)); } catch { continue; }
    const gt = LABELS[id];
    const gate = passesGates(e);
    const det = gate.ok ? detType(runPipeline(e, { senderMap: {} })[0]) : 'dismiss';
    let g = 'dismiss';
    if (gate.ok) { const r = await groq.classifyEmail({ subject: e.subject, text: e.body_text, sender: e.from }); if (!r) { g = null; gNull++; } else g = r.type; }
    n++;
    if (det === gt) detOk++;
    if (g === gt) gOk++; else if (g !== null) gMiss.push(`${gt}≠${g} | ${(e.subject || '').slice(0, 52)}`);
    await sleep(1200);
  }
  console.log(`\n=== accuracy vs ${n} human-labeled emails (model ${groq.MODEL}) ===`);
  console.log(`groq:          ${gOk}/${n} = ${(100 * gOk / n).toFixed(1)}%   (null fallbacks ${gNull})`);
  console.log(`deterministic: ${detOk}/${n} = ${(100 * detOk / n).toFixed(1)}%`);
  console.log(`\ngroq misses (${gMiss.length}) — review these after a prompt change; accuracy should not regress:`);
  gMiss.forEach((m) => console.log('  ' + m));
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
