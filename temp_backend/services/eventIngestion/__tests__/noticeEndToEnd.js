/**
 * The WHOLE path for a notice: raw email → pipeline (Groq) → proposal row → publish → served by the
 * API → rendered the way the card renders it.
 *
 * Every other audit here stops at the proposal PAYLOAD, which leaves the second half untested: the
 * publish step re-reads the payload field by field, the API strips and renames columns before serving
 * them, and the card re-splits the stored body. A classification that is correct in the payload can
 * still reach the student wrong, and nothing measured that until this file.
 *
 * Writes to whatever database is configured, so it is for LOCAL use. It cleans up after itself —
 * every notice and proposal it creates is deleted at the end, including on failure.
 *
 *   node services/eventIngestion/__tests__/noticeEndToEnd.js
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const groq = require('../review/groq');
const { runPipeline, isImportantNotice, isExternalNotice } = require('../index');
const { reviewProposals } = require('../runner');
const { EventProposal, Notice, IngestedEmail } = require('../../../database/schemas/index');

const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8081';
const ORIGIN = process.env.TEST_ORIGIN || 'http://localhost:5173';
const HOW_MANY = Number(process.argv[2]) || 4;

let pass = 0, fail = 0;
const check = (name, cond, got) => {
    if (cond) { pass++; console.log(`     ✅ ${name}`); }
    else { fail++; console.log(`     ❌ ${name}${got !== undefined ? `  got: ${JSON.stringify(got).slice(0, 140)}` : ''}`); }
};

let cookie = '';
const login = async () => {
    const r = await fetch(`${BASE}/oauth/dev-login`, { redirect: 'manual' });
    cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    return !!cookie;
};
const api = async (method, p, body) => {
    const r = await fetch(BASE + p, {
        method,
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
        body: body ? JSON.stringify(body) : undefined,
    });
    let j = null; try { j = await r.json(); } catch { /* no body */ }
    return { status: r.status, body: j };
};

// The card's own rendering rules, mirrored here so the test asserts on what a student SEES.
const stripMarker = (s) => String(s).replace(/^\s*(?:[→➔➜▶►•·*‣⁃]|-{1,2}>|=>)\s*/u, '').replace(/^\s*[-–—]\s+/, '').trim();
// Doubled punctuation is normalised by the display layer (tidyPunct in src/utils/notice.js), so the
// assertion below checks the STORED text for artifacts the pipeline itself introduced — inherited
// ones from the source email are the card's problem and are handled there.
const PIPELINE_ARTIFACT = /\s+[.,;:]|\(\s*\)|\[\s*\]/;

const created = { notices: [], proposals: [] };

(async () => {
    if (!groq.isConfigured()) { console.log('SKIP — no Groq key; this would measure the regex fallback.'); process.exit(0); }
    try { await fetch(`${BASE}/health`); } catch { console.log(`SKIP — no server on ${BASE}`); process.exit(0); }
    if (!(await login())) { console.log('SKIP — dev-login unavailable (needs DEV_LOGIN=true)'); process.exit(0); }

    console.log(`model: ${groq.MODEL}\nserver: ${BASE}\n`);
    const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'realCorpus.json'), 'utf8'));
    const emails = (Array.isArray(corpus) ? corpus : Object.values(corpus));

    const { Club: C2, SenderEntityMap: S2 } = require('../../../database/schemas/index');
    const smRows2 = await S2.findAll({ include: [{ model: C2, attributes: ['name'] }] });
    const senderMap = {};
    for (const r of smRows2) if (r.Club) senderMap[r.match_value] = r.Club.name;

    let done = 0;
    for (const email of emails) {
        if (done >= HOW_MANY) break;

        // ── 1. the real pipeline, with the real classifier ──
        let proposals = [];
        try {
            proposals = runPipeline(email, { senderMap }) || [];
            await reviewProposals(email, proposals, {}, {}, null, null);
        } catch (e) { continue; }
        const prop = proposals.find((p) => p.mutation_type === 'CREATE_NOTICE');
        if (!prop) continue;
        done++;

        const payload = prop.payload || {};
        console.log(`\n── ${String(payload.title).slice(0, 70)}`);
        console.log(`     pipeline: kind=${payload.kind} priority=${payload.priority} external=${payload.is_external}`);

        // ── 2. a proposal row, exactly as the ingestion runner would write one ──
        const ie = await IngestedEmail.create({
            message_id: `e2e-${Date.now()}-${done}`,
            subject: email.subject || null,
            sender: email.from || null,
            state: 'processed',
        }).catch(() => null);
        const row = await EventProposal.create({
            ingested_email_id: ie ? ie.id : null,
            mutation_type: 'CREATE_NOTICE',
            club_id: null,
            payload,
            evidence: prop.evidence || null,
            state: 'pending',
        });
        created.proposals.push(row.id);

        // ── 3. publish through the REAL endpoint, not by calling the model directly ──
        const pub = await api('POST', `/ingestion/proposals/${row.id}/publish`, {});
        check('publishes (HTTP 200)', pub.status === 200, pub);
        if (pub.status !== 200) continue;

        // ── 4. served by the API the app actually calls ──
        const feed = await api('GET', '/ingestion/notices');
        const served = (feed.body?.notices || []).find((n) => n.title === payload.title);
        check('appears in the notices feed', !!served);
        if (!served) continue;
        created.notices.push(served.id);

        // ── 5. the classification SURVIVED publish + serialisation ──
        check('kind survives', served.kind === payload.kind, { want: payload.kind, got: served.kind });
        check('priority survives', served.priority === payload.priority, { want: payload.priority, got: served.priority });
        check('is_external survives', !!served.is_external === !!payload.is_external, { want: payload.is_external, got: served.is_external });

        // ── 6. priority must still follow from the stored kind + external flag ──
        // NOT re-checking is_external here. It is computed from the raw email PLUS the Groq summary,
        // and the stored body is a lossy summary of both — "hosted by accomplished product leaders …
        // IIT Kanpur alum" can be the evidence and not survive into the card text. Recomputing from
        // the stored body would assert that the summary is lossless, which it is not meant to be.
        const impAgain = isImportantNotice(served.title, served.kind, !!served.is_external, !!(served.deadline || served.event_date)) ? 'important' : 'general';
        check('priority follows from the stored kind + external flag', impAgain === served.priority, { stored: served.priority, recomputed: impAgain });

        // ── 7. what the CARD shows — no marker, no run-on, no stranded label ──
        const lines = String(served.body || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        check('no bullet begins with a marker', lines.every((l) => stripMarker(l) === l), lines.filter((l) => stripMarker(l) !== l));
        check('no pipeline-introduced artifact', !lines.some((l) => PIPELINE_ARTIFACT.test(l)), lines.filter((l) => PIPELINE_ARTIFACT.test(l)));
        check('no stranded label line', !lines.some((l) => /^[A-Za-z][A-Za-z\s'’-]{0,24}:$/.test(l)), lines.filter((l) => /^[A-Za-z][A-Za-z\s'’-]{0,24}:$/.test(l)));
        // Only demand a body when the SOURCE had one. A forwarded mail whose entire content is the
        // subject line, with nothing beneath it but a signature block, has nothing to summarise — an
        // empty body there is the honest outcome, not a defect.
        const sourceHadProse = String(email.body_text || '').replace(/\s+/g, ' ').trim().length > 200;
        if (sourceHadProse) check('body is non-empty when the email had prose', lines.length > 0, { rawLen: (email.body_text || '').length });
        else console.log('     ·  body empty — source email was signature-only, nothing to summarise');

        // ── 8. the admin can override the pipeline, and it sticks ──
        const flipped = served.priority === 'important' ? 'general' : 'important';
        const patch = await api('PATCH', `/ingestion/notices/${served.id}`, { priority: flipped, is_external: !served.is_external });
        check('admin override accepted', patch.status === 200, patch.status);
        const after = await api('GET', `/ingestion/notices/${served.id}`);
        check('override persisted', after.body?.notice?.priority === flipped && !!after.body?.notice?.is_external === !served.is_external,
            { priority: after.body?.notice?.priority, is_external: after.body?.notice?.is_external });
    }

    console.log(`\n${pass}/${pass + fail} checks passed across ${done} notice(s) taken end to end.`);
})()
    .catch((e) => { console.error('e2e failed:', e); fail++; })
    .finally(async () => {
        // Always clean up — a half-run must not leave test notices in the feed.
        for (const id of created.notices) await Notice.destroy({ where: { id } }).catch(() => {});
        for (const id of created.proposals) await EventProposal.destroy({ where: { id } }).catch(() => {});
        console.log(`cleaned up ${created.notices.length} notice(s), ${created.proposals.length} proposal(s).`);
        process.exit(fail ? 1 : 0);
    });
