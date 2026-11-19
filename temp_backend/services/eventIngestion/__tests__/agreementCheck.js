/**
 * Measure LLM vs deterministic AGREEMENT on a real sample (Fable's mandated metric — not "100%").
 * Writes each decision to agreement.jsonl AS IT GOES (progress always visible, partial results kept)
 * and prints a running tally. classifyEmail self-paces on Groq's rate limits.
 * Run: node …/agreementCheck.js <limit> "<gmail-range>"
 */
require('dotenv').config();
const fs = require('fs');
const gmail = require('../source/gmail');
const groq = require('../review/groq');
const { runPipeline, passesGates } = require('../index');

const LIMIT = Number(process.argv[2]) || 200;
const RANGE = process.argv[3] || 'after:2026/01/01 before:2026/06/01';
const LISTS = 'to:students-notices@iitr.ac.in OR to:ug@iitr.ac.in OR to:pg@iitr.ac.in OR to:ug-1st-year@iitr.ac.in';
const OUT = `${__dirname}/agreement.jsonl`;
const typeOf = (p) => p.mutation_type === 'CREATE_EVENT' ? 'event' : p.mutation_type === 'CALENDAR_ENTRY' ? 'calendar' : p.mutation_type === 'DISMISS' ? 'dismiss' : (p.payload && p.payload.is_opportunity ? 'opportunity' : 'notice');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
    fs.writeFileSync(OUT, '');
    const ids = (await gmail.listMessageIds({ query: `(${LISTS}) ${RANGE}`, max: 5000 })).slice(0, LIMIT);
    console.log(`sampling ${ids.length} emails → ${OUT}`);
    let agree = 0, disagree = 0, nulled = 0, gated = 0, n = 0;
    for (const id of ids) {
        let e; try { e = gmail.normalizeMessage(await gmail.getMessage(id)); } catch { continue; }
        if (!passesGates(e).ok) { gated++; continue; }
        const det = typeOf(runPipeline(e, { senderMap: {} })[0]);
        const g = await groq.classifyEmail({ subject: e.subject, text: e.body_text, sender: e.from });
        n++;
        if (!g) { nulled++; } else if (g.type === det) { agree++; } else { disagree++; }
        fs.appendFileSync(OUT, JSON.stringify({ subject: (e.subject || '').slice(0, 90), det, llm: g ? g.type : null, kind: g ? g.kind : null }) + '\n');
        await sleep(8000);        // ~15 calls/min — stays under the 12k tokens/min free-tier ceiling
        if (n % 20 === 0) {
            const cl = agree + disagree;
            console.log(`  ${n} done | classified ${cl} | agree ${agree} (${cl ? (100 * agree / cl).toFixed(0) : 0}%) | disagree ${disagree} | null->fallback ${nulled}`);
        }
    }
    const cl = agree + disagree;
    console.log(`\nDONE. gate-dismissed ${gated} | classified ${cl} | null->fallback ${nulled}`);
    console.log(`AGREEMENT: ${agree}/${cl} = ${cl ? (100 * agree / cl).toFixed(1) : 0}%   (disagreements ${disagree})`);
    process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
