/**
 * Run 2 semesters of real mail through the EXACT live path (runner.processMessage): gate → Groq
 * privacy screen → store IngestedEmail → runPipeline → Groq reviewer → persist EventProposal rows.
 * Sequential, just like production polling. Persists to the DB. Clears ingestion tables first so it's
 * a clean "first boot over 2 semesters".
 * Run: node services/eventIngestion/__tests__/liveRun.js
 */
require('dotenv').config();
const gmail = require('../source/gmail');
const groq = require('../review/groq');
const { processMessage } = require('../runner');
const { SenderEntityMap, Club, IngestedEmail, EventProposal, IngestionState } = require('../../../database/schemas');

const LISTS = 'to:students-notices@iitr.ac.in OR to:ug@iitr.ac.in OR to:pg@iitr.ac.in OR to:ug-1st-year@iitr.ac.in';
const RANGE = 'after:2025/07/01 before:2026/06/01';   // Autumn 2025-26 + Spring 2026

async function loadSenderMap() {
    const rows = await SenderEntityMap.findAll({ include: [{ model: Club, attributes: ['name'] }] });
    const map = {}; for (const r of rows) if (r.Club) map[r.match_value] = r.Club.name; return map;
}

(async () => {
    console.log(`groq configured: ${groq.isConfigured()}`);
    // clean slate — as if the app booted for the first time and backfilled these 2 semesters
    await EventProposal.destroy({ where: {} });
    await IngestedEmail.destroy({ where: {} });
    await IngestionState.destroy({ where: { key: 'gmail_history_id' } });
    const senderMap = await loadSenderMap();
    const ids = await gmail.listMessageIds({ query: `(${LISTS}) ${RANGE}`, max: 5000 });
    console.log(`processing ${ids.length} emails through the LIVE path, sequentially…`);

    const out = { events: 0, notices: 0, calendar: 0, dismissed: 0, proposals: 0, skipped: 0, errors: 0 };
    const t0 = Date.now();
    for (let i = 0; i < ids.length; i++) {
        try { await processMessage(ids[i], senderMap, out); }
        catch (e) { out.errors++; }
        if ((i + 1) % 50 === 0) {
            const mins = ((Date.now() - t0) / 60000).toFixed(1);
            console.log(`  ${i + 1}/${ids.length} (${mins}m) — ${JSON.stringify(out)}`);
        }
    }
    console.log(`\nDONE in ${((Date.now() - t0) / 60000).toFixed(1)}m`);
    console.log('runner out:', JSON.stringify(out, null, 2));
    process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
