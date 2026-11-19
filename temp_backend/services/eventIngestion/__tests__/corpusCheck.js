/**
 * Deterministic corpus check for a date range (NO Groq — proves the GATE alone protects privacy).
 * Reports: gate breakdown, classification distribution, and — the key metric — how many PERSONAL
 * notices (viva-voce / examination-of-named-person / exposed enrolment no.) PASSED the gate (leaked).
 * Run: node …/corpusCheck.js "after:2025/07/01 before:2026/01/01" "Autumn 2025-26"
 */
require('dotenv').config();
const gmail = require('../source/gmail');
const { passesGates, runPipeline } = require('../index');

const RANGE = process.argv[2] || 'after:2026/01/01 before:2026/06/01';
const LABEL = process.argv[3] || RANGE;
const LISTS = 'to:students-notices@iitr.ac.in OR to:ug@iitr.ac.in OR to:pg@iitr.ac.in OR to:ug-1st-year@iitr.ac.in';
const PERSONAL = /viva[-\s]?voce|examination of (mr|ms|mrs|shri|smt|sri|dr)\b|\benrol?ment\s*(no|number)\s*[:.]?\s*\d{5,}/i;
const OPP_CUE = /scholarship|fellowship|freeship|financial assistance|recruit|\bpors?\b|hiring|internship|applications? (open|invited)|apply by|last date to apply/i;

async function pool(items, n, w) { let i = 0; const run = async () => { while (i < items.length) { await w(items[i++]); } }; await Promise.all(Array.from({ length: n }, run)); }
const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };

(async () => {
    const ids = await gmail.listMessageIds({ query: `(${LISTS}) ${RANGE}`, max: 5000 });
    const R = { total: ids.length, gate: {}, mutation: {}, personal_total: 0, personal_leaked: [], suspect_events: [] };
    await pool(ids, 6, async (id) => {
        let e; try { e = gmail.normalizeMessage(await gmail.getMessage(id)); } catch { return; }
        const isPersonal = PERSONAL.test(`${e.subject}\n${e.body_text || ''}`);
        if (isPersonal) R.personal_total++;
        const gate = passesGates(e);
        if (!gate.ok) { inc(R.gate, gate.reason); return; }
        if (isPersonal) R.personal_leaked.push(e.subject.slice(0, 80));   // ← PII that got through
        for (const p of runPipeline(e, { senderMap: {} })) {
            inc(R.mutation, p.mutation_type);
            if (p.mutation_type === 'CREATE_EVENT' && OPP_CUE.test(p.payload.title || '')) R.suspect_events.push((p.payload.title || '').slice(0, 74));
        }
    });
    console.log(`\n===== ${LABEL} =====`);
    console.log(`corpus: ${R.total} broadcast emails`);
    console.log(`gate-dismissed:`, JSON.stringify(R.gate));
    console.log(`classified:`, JSON.stringify(R.mutation));
    console.log(`\nPERSONAL notices in corpus: ${R.personal_total}`);
    console.log(`PERSONAL notices that LEAKED past the gate: ${R.personal_leaked.length}`);
    R.personal_leaked.slice(0, 20).forEach((s) => console.log(`   ⚠️  ${s}`));
    console.log(`\nSUSPECT events (apply/scholarship/recruit cue in title → likely misfiled): ${R.suspect_events.length} of ${R.mutation.CREATE_EVENT || 0}`);
    R.suspect_events.slice(0, 25).forEach((s) => console.log(`   ⚠️  ${s}`));
    process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
