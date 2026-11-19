/**
 * Does the LLM recover the deadlines the regex cannot read?
 * Runs the PRODUCTION path (runPipeline -> reviewProposals) on emails whose deterministic extraction
 * produced no deadline despite the email plainly stating one, and reports what the final payload has.
 */
require('dotenv').config({ quiet: true });
const gmail = require('../source/gmail');
const { runPipeline, passesGates, extract, stripSubject, topMessage } = require('../index');
const { reviewProposals } = require('../runner');
const { SenderEntityMap } = require('../../../database/schemas');

const N = Number(process.argv[2]) || 10;
const PACE = Number(process.env.AUDIT_PACE_MS) || 25000;
const LISTS = 'to:students-notices@iitr.ac.in OR to:ug@iitr.ac.in OR to:pg@iitr.ac.in';
const PHRASE = /last date|deadline|apply by|register by|submit by|closes on|last day/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const rows = await SenderEntityMap.findAll({ attributes: ['match_value'], raw: true });
  const senders = new Set(rows.map((r) => r.match_value).filter(Boolean));
  ['gensec.technical', 'gensec-sports', 'gensec.cult', 'sangram', 'thomso', 'nss', 'hec', 'ecell', 'smp', 'sanskrit']
    .forEach((s) => senders.add(`${s}@iitr.ac.in`));
  const q = `(${[...senders].map((s) => `from:${s}`).join(' OR ')}) (${LISTS}) newer_than:200d`;
  const ids = await gmail.listMessageIds({ query: q, max: 200 });

  let checked = 0, recovered = 0, still = 0;
  for (const id of ids) {
    if (checked >= N) break;
    const full = await gmail.getMessage(id);
    if (!full) continue;
    const e = gmail.normalizeMessage(full);
    if (!passesGates(e).ok) continue;
    const body = `${stripSubject(e.subject)}\n${topMessage(e.body_text)}`;
    if (!PHRASE.test(body)) continue;
    if (extract(e).registration_deadline) continue;      // regex already got it — not our population
    checked++;
    await sleep(PACE);
    const proposals = runPipeline(e, { senderMap: {}, clubIndex: [] });
    await reviewProposals(e, proposals, {}, {}, null);
    const p = proposals[0];
    const dl = (p.payload && (p.payload.deadline || p.payload.registration_deadline)) || null;
    const src = (p.evidence && p.evidence.source) || '?';
    if (dl) recovered++; else still++;
    console.log(`${dl ? 'RECOVERED ' + dl : 'STILL MISSING'}  [${src}]  ${stripSubject(e.subject).replace(/\s+/g,' ').slice(0, 56)}`);
  }
  console.log(`\nregex-missed deadlines checked: ${checked} | LLM recovered: ${recovered} | still missing: ${still}`);
  process.exit(0);
})();
