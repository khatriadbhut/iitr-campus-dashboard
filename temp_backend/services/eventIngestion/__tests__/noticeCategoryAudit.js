/**
 * How accurately are notices CATEGORISED — kind, priority and external — by the real pipeline?
 *
 * Runs the PRODUCTION path (runPipeline → reviewProposals, Groq primary with the deterministic rule
 * as fallback) over the cached corpus, so what is measured is what a student would actually see. A
 * regex-only audit measures a path that almost never decides anything in production.
 *
 * Read-only: no DB writes. Prints every notice with its decisions so the output can be hand-checked,
 * then scores against the expectations in noticeCategoryExpectations.json when that file exists.
 *
 *   node services/eventIngestion/__tests__/noticeCategoryAudit.js            # run + print
 *   node services/eventIngestion/__tests__/noticeCategoryAudit.js --score    # also score vs labels
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const groq = require('../review/groq');
const { runPipeline } = require('../index');
const { reviewProposals } = require('../runner');

const CORPUS = path.join(__dirname, 'realCorpus.json');
const LABELS = path.join(__dirname, 'noticeCategoryExpectations.json');
const SCORE = process.argv.includes('--score');

const noticeOf = (proposals) => proposals.find((p) => p.mutation_type === 'CREATE_NOTICE');

(async () => {
    if (!groq.isConfigured()) {
        console.log('SKIP — no Groq key configured. This audit is meaningless against the regex fallback.');
        process.exit(0);
    }
    console.log(`model: ${groq.MODEL}\n`);

    const corpus = JSON.parse(fs.readFileSync(CORPUS, 'utf8'));
    const emails = Array.isArray(corpus) ? corpus : Object.values(corpus);

    // The REAL sender map. Passing {} leaves every sender unknown, so the attribution ladder never
    // reaches its first tier and every proposal comes out as Institute — the audit would be measuring
    // a configuration that does not exist in production.
    const { Club, SenderEntityMap } = require('../../../database/schemas/index');
    const smRows = await SenderEntityMap.findAll({ include: [{ model: Club, attributes: ['name'] }] });
    const senderMap = {};
    for (const r of smRows) if (r.Club) senderMap[r.match_value] = r.Club.name;

    const results = [];
    for (let i = 0; i < emails.length; i++) {
        const email = emails[i];
        let proposals = [];
        try {
            proposals = runPipeline(email, { senderMap }) || [];
            // The production classifier. Without this the run measures the regex, not the pipeline.
            await reviewProposals(email, proposals, {}, {}, null, null);
        } catch (e) {
            console.log(`  [${i + 1}] ERROR ${String(e.message).slice(0, 70)}`);
            continue;
        }
        const n = noticeOf(proposals);
        if (!n) continue;
        const p = n.payload || {};
        results.push({
            subject: email.subject,
            title: p.title,
            kind: p.kind,
            priority: p.priority,
            is_external: p.is_external,
            is_opportunity: p.is_opportunity,
            deadline: p.deadline || null,
            body: p.body || '',
        });
        process.stdout.write(`\r  classified ${results.length} notice(s) from ${i + 1}/${emails.length} emails…`);
    }
    console.log('\n');

    console.log(`${'KIND'.padEnd(13)}${'PRIORITY'.padEnd(11)}${'EXT'.padEnd(6)}TITLE`);
    console.log('-'.repeat(100));
    for (const r of results) {
        console.log(`${String(r.kind).padEnd(13)}${String(r.priority).padEnd(11)}${(r.is_external ? 'yes' : '-').padEnd(6)}${String(r.title).slice(0, 62)}`);
    }

    const count = (f) => results.reduce((m, r) => { const k = String(f(r)); m[k] = (m[k] || 0) + 1; return m; }, {});
    console.log(`\nnotices: ${results.length}`);
    console.log('kind      :', count((r) => r.kind));
    console.log('priority  :', count((r) => r.priority));
    console.log('external  :', count((r) => !!r.is_external));

    // Formatting must survive the real Groq summary, not just the stored bodies.
    const bad = [];
    for (const r of results) {
        if (/^[\s]*(?:[→➔•·*]|-{1,2}>)/.test(r.body)) bad.push(['leading marker', r.title, r.body.slice(0, 60)]);
        if (/\s+[.,;:]/.test(r.body)) bad.push(['space before punctuation', r.title, r.body.slice(0, 60)]);
        if (/[.,;:]{2,}/.test(r.body)) bad.push(['doubled punctuation', r.title, r.body.slice(0, 60)]);
        if (/\(\s*\)|\[\s*\]/.test(r.body)) bad.push(['empty brackets', r.title, r.body.slice(0, 60)]);
        // Check PER LINE. Against the whole body, /\s{2,}/ matches the deliberate blank line the
        // pipeline puts between the action and the prose — 19 false positives on the first run.
        for (const line of String(r.body).split('\n')) {
            if (/  +/.test(line)) bad.push(['double space', r.title, line.slice(0, 60)]);
        }
    }
    console.log(`\nbody formatting artifacts in Groq output: ${bad.length}`);
    bad.slice(0, 8).forEach(([k, t, b]) => console.log(`   ${k} — ${String(t).slice(0, 40)}\n      ${b}`));

    fs.writeFileSync(path.join(__dirname, 'noticeCategoryAudit.out.json'), JSON.stringify(results, null, 2));
    console.log(`\nwrote ${results.length} rows to noticeCategoryAudit.out.json`);

    if (!SCORE) process.exit(0);
    if (!fs.existsSync(LABELS)) {
        console.log(`\nNo expectations file at ${path.basename(LABELS)} — nothing to score against.`);
        process.exit(0);
    }
    const labels = JSON.parse(fs.readFileSync(LABELS, 'utf8'));
    // Match on a stable substring, not the exact title — Groq re-words titles slightly between runs,
    // and exact matching silently dropped rows from the score rather than failing loudly.
    const labelFor = (title) => labels.find((l) => String(title || '').toLowerCase().includes(String(l.match).toLowerCase()));
    let kOk = 0, pOk = 0, eOk = 0, n = 0;
    const misses = [];
    const unlabelled = [];
    for (const r of results) {
        const l = labelFor(r.title);
        if (!l) { unlabelled.push(r.title); continue; }
        n++;
        if (l.kind === r.kind) kOk++; else misses.push(['kind', r.title, l.kind, r.kind]);
        if (l.priority === r.priority) pOk++; else misses.push(['priority', r.title, l.priority, r.priority]);
        if (!!l.is_external === !!r.is_external) eOk++; else misses.push(['external', r.title, l.is_external, r.is_external]);
    }
    const pc = (a) => `${a}/${n} (${n ? Math.round((a / n) * 100) : 0}%)`;
    console.log(`\n── scored against ${n} hand labels ──`);
    console.log('kind     :', pc(kOk));
    console.log('priority :', pc(pOk));
    console.log('external :', pc(eOk));
    if (unlabelled.length) {
        // Loudly, so a shrinking denominator can never look like a clean score.
        console.log(`\nUNLABELLED (${unlabelled.length}) — not scored:`);
        unlabelled.forEach((t) => console.log(`   ${String(t).slice(0, 60)}`));
    }
    if (misses.length) {
        console.log('\nMISSES:');
        misses.forEach(([f, t, want, got]) => console.log(`   ${f.padEnd(9)} want=${String(want).padEnd(12)} got=${String(got).padEnd(12)} ${String(t).slice(0, 50)}`));
    }
    process.exit(0);
})().catch((e) => { console.error('audit failed:', e); process.exit(1); });
