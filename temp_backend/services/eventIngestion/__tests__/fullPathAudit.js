/**
 * What does the REAL pipeline decide — not the regex fallback?
 *
 * In production Groq is the PRIMARY classifier; the deterministic rule only runs when Groq is
 * unavailable or returns junk. Auditing the regex alone therefore measures a path that almost never
 * decides anything. This runs both on the same emails and reports where they disagree, so the true
 * event/notice split is measured rather than assumed.
 *
 * Read-only: no DB writes, no proposals. Run: node .../fullPathAudit.js [count]
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const gmail = require('../source/gmail');
const groq = require('../review/groq');
const { runPipeline, passesGates, stripSubject } = require('../index');
// The PRODUCTION classifier is runPipeline → reviewProposals (Groq primary, regex fallback). Calling
// groq.classifyEmail directly would re-implement it and could drift; this uses the real function.
const { reviewProposals } = require('../runner');

const N = Number(process.argv[2]) || 150;
const OUT = process.argv[3] || '/private/tmp/claude-501/-Users-adbhut-Campus-Dashboard-Event-Planner/ac91cb0a-d57e-4d6a-a4d7-84f3a9d57247/scratchpad/fullpath.json';
const LISTS = 'to:students-notices@iitr.ac.in OR to:ug@iitr.ac.in OR to:pg@iitr.ac.in OR to:ug-1st-year@iitr.ac.in';

// CLUB_ONLY=1 restricts the draw to club / student-body senders. A random draw spends half its (very
// limited) token budget on office mail, which is not the question — "do CLUB things end up in notices"
// is only answerable by measuring club mail. Senders taken from the observed top-40 in the corpus.
const CLUB_SENDERS = [
    'gensec.technical', 'gensec.cult', 'gensec.pgacads', 'gensec-sports', 'gensec.hostel', 'gensec.ughostel',
    'gensec.pghostel', 'nss', 'sports', 'fitindia', 'vsc', 'hec', 'sangram', 'thomso', 'cognizance',
    'srishti', 'guptafcc', 'cig', 'tic', 'uba', 'sanskrit', 'hindicell', 'cinemaclub', 'ccf', 'adci',
].map((s) => `from:${s}@iitr.ac.in`).join(' OR ');
const QUERY = process.env.CLUB_ONLY === '1'
    ? `(${CLUB_SENDERS}) (${LISTS}) newer_than:400d`
    : `(${LISTS}) newer_than:400d`;

const detType = (p) => {
    if (p.mutation_type === 'CREATE_EVENT') return 'event';
    if (p.mutation_type === 'CALENDAR_ENTRY') return 'calendar';
    if (p.mutation_type === 'DISMISS') return 'dismiss';
    if (p.mutation_type === 'PATCH_NOTICE') return 'patch_notice';
    if (p.mutation_type === 'PATCH_EVENT' || p.mutation_type === 'CANCEL_EVENT') return 'lifecycle';
    return p.payload && p.payload.is_opportunity ? 'opportunity' : 'notice';
};

const pool = async (items, n, worker) => {
    let i = 0;
    const run = async () => { while (i < items.length) { const idx = i++; try { await worker(items[idx], idx); } catch (e) { /* keep going */ } } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
};

(async () => {
    if (!gmail.isConfigured() || !groq.isConfigured()) { console.error('need GMAIL + GROQ configured'); process.exit(1); }
    // ACCUMULATE across runs. The free tier only funds ~45 classifications a day, so one run can never
    // measure enough. Results are keyed by gmail id and merged into the same file, and any id already
    // carrying a real LLM verdict is skipped — so each new day (or new key) spends its whole budget on
    // UNSEEN mail and the sample actually grows instead of re-measuring the newest emails forever.
    let prior = [];
    try { prior = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* first run */ }
    // Rows written before gmail_id was recorded cannot be MERGED (keying a Map on `undefined` would
    // collapse them all into one entry), but they must still count as measured — otherwise the run
    // re-classifies mail we already have verdicts for and burns a whole day's token budget on nothing.
    // That is exactly what happened once: 45 legacy rows were dropped, the skip-set came out empty, and
    // an entire fresh key was spent re-measuring the same emails. So: drop them from the merge, keep
    // them in the skip-set via a subject+sender key.
    const legacy = prior.filter((r) => !r.gmail_id);
    if (legacy.length) console.log(`note: ${legacy.length} legacy row(s) without gmail_id — kept in the skip-set, excluded from the merge`);
    const contentKey = (s, f) => `${(s || '').trim().toLowerCase()}|${(f || '').toLowerCase()}`;
    const doneContent = new Set(prior.filter((r) => r.llm_answered).map((r) => contentKey(r.subject, r.from)));
    prior = prior.filter((r) => r.gmail_id);
    const done = new Set(prior.filter((r) => r.llm_answered).map((r) => r.gmail_id).filter(Boolean));
    const all = await gmail.listMessageIds({ query: QUERY, max: 500 });
    const ids = all.filter((id) => !done.has(id));
    console.log(`${all.length} matching mails; ${done.size} already have a real verdict; ${ids.length} left to measure`);
    console.log(`fetched ${ids.length} ids; classifying up to ${N} gate-passing mails through BOTH paths`);

    const rows = [];
    // Sequential + paced, exactly like runIngest's bulk path (`pace` → 4.5s between messages). Groq's
    // free tier is 12,000 tokens/MINUTE and one classify is ~2k, so anything faster trips 429 — and the
    // client's bounded retry (maxWaitMs 7s) cannot outlast a 60s window, so it returns null and the
    // whole run silently degrades to regex. Pacing here is what makes the measurement faithful.
    // Pacing must match the MODEL's per-minute token bucket. MEASURED, not guessed: one classify on
    // gpt-oss-120b with an 8,000-char body costs 2,489 tokens (1,751 prompt + 738 completion, 551 of
    // that reasoning) and the bucket is 8,000/min — so ~3.2 calls/min, one every ~20s.
    // The model itself answers in 1.6s; pacing is purely about the token bucket, not model speed.
    // Get this wrong and it fails INVISIBLY: at 4.5s (the old llama pacing) it attempts ~32k tokens/min,
    // 429s on nearly every call, exhausts the 4 bounded retries, returns null, and the run quietly
    // measures the regex fallback while looking like it measured the LLM.
    const PACE_MS = Number(process.env.AUDIT_PACE_MS) || 20000;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await pool(ids, 1, async (id) => {
        // Check the target BEFORE sleeping. With the sleep first, the run kept pacing through every
        // remaining id after it had already collected N — the club query returns 500 ids, so a 60-email
        // run spent 440 x 4.5s = 33 extra minutes asleep doing nothing, and made the model look ~3x
        // slower than it is.
        if (rows.length >= N) return;
        await sleep(PACE_MS);
        const full = await gmail.getMessage(id);
        if (!full) return;
        const email = gmail.normalizeMessage(full);
        if (!passesGates(email).ok) return;
        // second skip gate, after the (free) Gmail fetch but BEFORE the (paid) Groq call — catches
        // legacy rows that have no gmail_id to match on
        if (doneContent.has(contentKey(stripSubject(email.subject).replace(/\s+/g, ' ').slice(0, 80), (email.from || '').replace(/.*<|>.*/g, '')))) return;

        const proposals = runPipeline(email, { senderMap: {}, clubIndex: [] });
        const dt = detType(proposals[0]);
        // real production call — mutates `proposals` in place and stamps evidence.source
        const out = {};
        await reviewProposals(email, proposals, {}, out, null);
        const final = proposals[0];
        const ev = final.evidence || {};
        const r = {
            gmail_id: email.gmail_id,
            subject: stripSubject(email.subject).replace(/\s+/g, ' ').slice(0, 80),
            from: (email.from || '').replace(/.*<|>.*/g, ''),
            deterministic: dt,
            // what the pipeline ACTUALLY produced, and whether an LLM or the regex decided it
            final: detType(final),
            source: ev.source || 'unknown',        // llm | deterministic_fallback | llm_fields
            llm_answered: ev.source === 'llm' || ev.source === 'llm_fields',
            groq_kind: (ev.groq && ev.groq.kind) || null,
            groq_conf: (ev.groq && ev.groq.confidence) || null,
            agreed: ev.agreed === undefined ? null : ev.agreed,
        };
        rows.push(r);
        // CHECKPOINT after every email. The reasoning model takes ~30s each, so a 60-email run is half
        // an hour and a 200-email sweep is hours — losing all of it to a crash, a quota wall or a
        // Ctrl-C at email 190 is not acceptable. Writing as we go also makes progress observable:
        // the file length IS the progress bar, since stdout may be buffered by a pipe.
        try { fs.writeFileSync(OUT + '.partial', JSON.stringify(rows, null, 1)); } catch (e) { /* non-fatal */ }
        const stamp = `${rows.length}/${N} ${r.final}  ${r.subject.slice(0, 46)}`;
        console.log('  ' + stamp);
        try { fs.appendFileSync(OUT + '.progress', stamp + '\n'); } catch (e) { /* non-fatal */ }
    });

    // merge this run into the accumulated file: a real LLM verdict always wins over a fallback row
    const byId = new Map(prior.map((r) => [r.gmail_id, r]));
    for (const r of rows) {
        const old = byId.get(r.gmail_id);
        if (!old || (!old.llm_answered && r.llm_answered)) byId.set(r.gmail_id, r);
    }
    const merged = [...byId.values()];
    const rowsAll = merged.filter((r) => r.llm_answered);
    console.log(`\nCUMULATIVE across all runs: ${merged.length} measured, ${rowsAll.length} with a real LLM verdict`);

    const ok = rows.filter((r) => r.llm_answered);
    const tally = (key) => rows.reduce((m, r) => { const k = r[key] || '(none)'; m[k] = (m[k] || 0) + 1; return m; }, {});
    console.log(`\nclassified ${rows.length} through the PRODUCTION path`);
    console.log(`  decided by Groq: ${ok.length}   |   fell back to regex: ${rows.length - ok.length}`);
    console.log('\nPRODUCTION OUTPUT (what students would actually see):'); console.table(tally('final'));
    console.log('regex-only, for comparison:'); console.table(tally('deterministic'));
    console.log('who decided:'); console.table(tally('source'));

    const dis = ok.filter((r) => r.agreed === false);
    if (ok.length) console.log(`\nof the ${ok.length} Groq decided, it kept the regex verdict ${ok.length - dis.length} times (${Math.round((ok.length - dis.length) / ok.length * 100)}%)`);
    const moves = {};
    dis.forEach((r) => { const k = `${r.deterministic} → ${r.final}`; moves[k] = (moves[k] || 0) + 1; });
    if (dis.length) { console.log('\nwhere Groq OVERRODE the regex:'); console.table(moves); }
    console.log('\nregex said NOTICE, production says EVENT:');
    dis.filter((r) => r.deterministic === 'notice' && r.final === 'event')
        .forEach((r) => console.log('   ', r.from.split('@')[0].padEnd(20), r.subject.slice(0, 58)));

    // CUMULATIVE verdict table — the number that actually answers the question, growing each run
    if (rowsAll.length) {
        const ct = {}; rowsAll.forEach((r) => { ct[r.final] = (ct[r.final] || 0) + 1; });
        console.log('\nCUMULATIVE production verdicts (LLM-decided only):'); console.table(ct);
    }

    fs.writeFileSync(OUT, JSON.stringify(merged, null, 1));
    console.log('\nwrote ' + OUT + ` (${merged.length} rows)`);
})();
