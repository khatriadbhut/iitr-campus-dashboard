/**
 * Inbox Replay — regenerate the PROPOSED queue from already-stored emails under the CURRENT rules.
 * Deterministic only (no Groq): re-runs runPipeline over each parsed ingested_email, replacing the
 * pending proposals. Already-actioned emails (a published/dismissed proposal) are left untouched.
 * Run: node services/eventIngestion/__tests__/reclassify.js
 */
require('dotenv').config();
const { Op } = require('sequelize');
const { runPipeline, RULE_VERSION } = require('../index');
const { IngestedEmail, EventProposal, SenderEntityMap, Club } = require('../../../database/schemas');

async function loadSenderMap() {
    const rows = await SenderEntityMap.findAll({ include: [{ model: Club, attributes: ['name'] }] });
    const map = {};
    for (const r of rows) if (r.Club) map[r.match_value] = r.Club.name;
    return map;
}

(async () => {
    const senderMap = await loadSenderMap();
    // emails that were already reviewed (published/dismissed) — don't resurrect them
    const actioned = await EventProposal.findAll({ where: { state: { [Op.in]: ['published', 'dismissed'] } }, attributes: ['ingested_email_id'], raw: true });
    const actionedIds = new Set(actioned.map((a) => a.ingested_email_id));

    const delN = await EventProposal.destroy({ where: { state: 'proposed' } });   // clear the pending queue
    const emails = await IngestedEmail.findAll({ where: { state: 'parsed', body_text: { [Op.ne]: null } }, raw: true });

    let created = 0, skipped = 0;
    const byType = {};
    for (const e of emails) {
        if (actionedIds.has(e.id)) { skipped++; continue; }
        const email = { from: e.from_addr, to: e.to_addrs, subject: e.subject, body_text: e.body_text, message_id: e.message_id, thread_id: e.thread_id, internal_date: e.internal_date };
        let proposals;
        try { proposals = runPipeline(email, { senderMap }); } catch { continue; }
        for (const p of proposals) {
            if (p.mutation_type === 'DISMISS') continue;
            await EventProposal.create({
                ingested_email_id: e.id,
                mutation_type: p.mutation_type,
                club_id: null,
                target_event_id: null,
                payload: { ...p.payload, club: p.club || null, _from: e.from_addr, _message_id: e.message_id },
                evidence: { ...(p.evidence || {}), rule_version: RULE_VERSION, source: 'deterministic_replay' },
                state: 'proposed',
            });
            created++;
            byType[p.mutation_type] = (byType[p.mutation_type] || 0) + 1;
        }
    }
    console.log(`deleted ${delN} proposed | scanned ${emails.length} emails (skipped ${skipped} actioned) | regenerated ${created}`);
    console.log('by type:', JSON.stringify(byType));
    process.exit(0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
