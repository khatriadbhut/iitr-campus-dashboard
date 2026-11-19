/**
 * Dry-run the FULL ingestion system over a whole semester of real broadcast mail — no DB writes.
 * Mirrors runner.processMessage exactly (gate → Groq privacy screen → pipeline → Groq reviewer) but
 * tallies instead of persisting. Prints a classification report + samples.
 * Run: node services/eventIngestion/__tests__/semesterRun.js "after:2026/01/01 before:2026/06/01"
 */
require('dotenv').config();
const gmail = require('../source/gmail');
const groq = require('../review/groq');
const { runPipeline, passesGates } = require('../index');
const { reviewProposals } = require('../runner');
const { SenderEntityMap, Club } = require('../../../database/schemas');

const RANGE = process.argv[2] || 'after:2026/01/01 before:2026/06/01';
const LISTS = 'to:students-notices@iitr.ac.in OR to:ug@iitr.ac.in OR to:pg@iitr.ac.in OR to:ug-1st-year@iitr.ac.in';
const QUERY = `(${LISTS}) ${RANGE}`;
const CONCURRENCY = 6;

async function loadSenderMap() {
    const rows = await SenderEntityMap.findAll({ include: [{ model: Club, attributes: ['name'] }] });
    const map = {};
    for (const r of rows) if (r.Club) map[r.match_value] = r.Club.name;
    return map;
}

// simple bounded-concurrency pool
async function pool(items, n, worker) {
    let i = 0;
    const runNext = async () => { while (i < items.length) { const idx = i++; await worker(items[idx], idx); } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, runNext));
}

const inc = (obj, k) => { obj[k] = (obj[k] || 0) + 1; };

(async () => {
    console.log(`query: ${QUERY}`);
    const senderMap = await loadSenderMap();
    const ids = await gmail.listMessageIds({ query: QUERY, max: 5000 });
    console.log(`fetched ${ids.length} message ids — processing with concurrency ${CONCURRENCY}…`);

    const R = {
        total: ids.length, fetched: 0, errors: 0,
        gate_dismissed: {}, privacy_dropped: 0, privacy_samples: [],
        mutation: {}, notice_kind: {}, reason_codes: {}, reviewed: 0, reclassified: 0,
        samples: { CREATE_EVENT: [], CREATE_NOTICE_opp: [], CREATE_NOTICE_info: [], CALENDAR_ENTRY: [] },
        dismissed_samples: [],
    };
    let done = 0;

    await pool(ids, CONCURRENCY, async (id) => {
        let email;
        try { email = gmail.normalizeMessage(await gmail.getMessage(id)); R.fetched++; }
        catch (e) { R.errors++; return; }
        if (++done % 100 === 0) console.log(`  …${done}/${ids.length}`);

        const gate = passesGates(email);
        if (!gate.ok) {
            inc(R.gate_dismissed, gate.reason);
            if (R.dismissed_samples.length < 15) R.dismissed_samples.push(`[${gate.reason}] ${email.from.split('<')[0].trim()} — ${email.subject}`.slice(0, 110));
            return;
        }
        if (groq.isConfigured()) {
            const scr = await groq.screenPrivacy({ subject: email.subject, text: email.body_text });
            if (scr && scr.personal) {
                R.privacy_dropped++;
                if (R.privacy_samples.length < 20) R.privacy_samples.push(`${email.subject} — (${scr.reason})`.slice(0, 110));
                return;
            }
        }
        const proposals = runPipeline(email, { senderMap });
        const out = {};
        await reviewProposals(email, proposals, senderMap, out);
        R.reviewed += out.reviewed || 0; R.reclassified += out.reclassified || 0;
        for (const p of proposals) {
            inc(R.mutation, p.mutation_type);
            if (p.evidence && p.evidence.reason_codes) for (const rc of p.evidence.reason_codes) inc(R.reason_codes, rc);
            if (p.mutation_type === 'CREATE_NOTICE') {
                inc(R.notice_kind, (p.payload && p.payload.kind) || '?');
                const bucket = p.payload && p.payload.is_opportunity ? 'CREATE_NOTICE_opp' : 'CREATE_NOTICE_info';
                if (R.samples[bucket].length < 8) R.samples[bucket].push((p.payload.title || '').slice(0, 78));
            } else if (R.samples[p.mutation_type] && R.samples[p.mutation_type].length < 8) {
                R.samples[p.mutation_type].push(`${p.club ? p.club + ': ' : ''}${(p.payload && p.payload.title) || ''}`.slice(0, 78));
            }
        }
    });

    const fs = require('fs');
    fs.writeFileSync(`${__dirname}/semesterRun.result.json`, JSON.stringify(R, null, 2));
    console.log('\n==================== SEMESTER RUN REPORT ====================');
    console.log(`corpus: ${R.total} broadcast emails | fetched ${R.fetched} | fetch errors ${R.errors}`);
    const gd = Object.values(R.gate_dismissed).reduce((a, b) => a + b, 0);
    console.log(`\nGATE-DISMISSED: ${gd}`);
    Object.entries(R.gate_dismissed).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${k.padEnd(22)} ${v}`));
    console.log(`\nPRIVACY-DROPPED (Groq screen): ${R.privacy_dropped}`);
    console.log(`\nCLASSIFIED (proposals):`);
    Object.entries(R.mutation).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${k.padEnd(16)} ${v}`));
    const opp = (R.samples.CREATE_NOTICE_opp || []).length, info = (R.samples.CREATE_NOTICE_info || []).length;
    console.log(`\nNOTICE KINDS:`);
    Object.entries(R.notice_kind).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${k.padEnd(14)} ${v}`));
    console.log(`\nREASON CODES:`);
    Object.entries(R.reason_codes).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`   ${k.padEnd(24)} ${v}`));
    console.log(`\nGROQ: reviewed(uncertain) ${R.reviewed} | reclassified ${R.reclassified}`);
    console.log('\nfull report + samples → semesterRun.result.json');
    process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
