/**
 * FULL-PIPELINE SWEEP across every kind of campus mail, exactly as production runs it:
 *   gates → runPipeline → reviewProposals (Groq primary, regex fallback).
 *
 * Stratified by sender type so a random draw cannot bury the rarer categories (departments, deans,
 * library, hostel, governance) under the high-volume club senders. Gate-dropped mail is recorded too
 * — dropping personal data is part of the pipeline's job and costs no tokens to verify.
 *
 * Checkpoints after every email. Run: node fullSweep.cjs [perBucket] [outfile]
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const gmail = require('../source/gmail');
const groq = require('../review/groq');
const { runPipeline, passesGates, stripSubject } = require('../index');
const { reviewProposals } = require('../runner');
const { SenderEntityMap, Club } = require('../../../database/schemas');

const PER = Number(process.argv[2]) || 12;
const OUT = process.argv[3] || '/private/tmp/claude-501/-Users-adbhut-Campus-Dashboard-Event-Planner/ac91cb0a-d57e-4d6a-a4d7-84f3a9d57247/scratchpad/sweep.json';
const PACE = Number(process.env.AUDIT_PACE_MS) || 25000;
const LISTS = 'to:students-notices@iitr.ac.in OR to:ug@iitr.ac.in OR to:pg@iitr.ac.in OR to:ug-1st-year@iitr.ac.in';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// sender → bucket. First match wins; order matters (specific before generic).
const BUCKETS = [
    ['academic',   /^(donotreply-acad|aao|arcurriculum|adaa|aradmission|daa)/i],
    ['deans',      /^(dean|adosw|adoswsa|adoswsw|adii|adci|dosw|convener|chairman|registrar|ar\.)/i],
    ['department', /^head@|^head\.|^fc\./i],
    ['library',    /^(library|librarian|mgcl|sksunnymgcl)/i],
    ['hostel',     /^(gensec\.hostel|gensec\.ughostel|gensec\.pghostel|warden|mess)/i],
    ['awards',     /^(awards|ch\.awards|scsp)/i],
    ['placement',  /^(office_cdc|cdc|tnp|pic)/i],
    ['club',       /^(gensec|nss|sports|fitindia|vsc|hec|sangram|thomso|cognizance|srishti|guptafcc|cig|tic|uba|sanskrit|hindicell|cinemaclub|ncc|smp|ecell|spicmacay|ceo_tides|ircell)/i],
];
const bucketOf = (from) => {
    const local = (from || '').split('@')[0].toLowerCase();
    for (const [name, re] of BUCKETS) if (re.test(local) || re.test(from)) return name;
    return 'other';
};

const detType = (p) => {
    if (p.mutation_type === 'CREATE_EVENT') return 'event';
    if (p.mutation_type === 'CALENDAR_ENTRY') return 'calendar';
    if (p.mutation_type === 'DISMISS') return 'dismiss';
    if (p.mutation_type === 'PATCH_NOTICE') return 'deadline_extended';
    if (p.mutation_type === 'PATCH_EVENT' || p.mutation_type === 'CANCEL_EVENT') return 'lifecycle';
    return p.payload && p.payload.is_opportunity ? 'opportunity' : 'notice';
};

(async () => {
    if (!gmail.isConfigured() || !groq.isConfigured()) { console.error('need GMAIL + GROQ'); process.exit(1); }
    const smRows = await SenderEntityMap.findAll({ include: [{ model: Club, attributes: ['name'] }] });
    const senderMap = {}; for (const r of smRows) if (r.Club) senderMap[r.match_value] = r.Club.name;
    const clubs = await Club.findAll({ attributes: ['name'], raw: true });
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim();
    const clubIndex = [];
    for (const { name } of clubs) {
        const al = new Set([name]); const m = /^([^(]+?)\s*\(([^)]+)\)\s*$/.exec(name);
        if (m) { al.add(m[1].trim()); al.add(m[2].trim()); }
        for (const a of [...al]) al.add(a.replace(/\s*IITR?$/i, '').trim());
        for (const a of al) { const n = norm(a); if (n.length >= 3) clubIndex.push([n, name]); }
    }
    clubIndex.sort((a, b) => b[0].length - a[0].length);

    // Skip anything a previous run already measured, so a fresh run evaluates UNSEEN mail instead of
    // re-scoring the same emails. Reads every prior result file in the scratch dir.
    const seen = new Set();
    const dir = OUT.replace(/\/[^/]+$/, '');
    for (const f of fs.readdirSync(dir)) {
        if (!/\.json(\.partial)?$/.test(f)) continue;
        try {
            const d = JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
            const rows = Array.isArray(d) ? d : (d.rows || []);
            rows.forEach((x) => x.gmail_id && seen.add(x.gmail_id));
        } catch (e) { /* not a result file */ }
    }
    const allIds = await gmail.listMessageIds({ query: `(${LISTS}) newer_than:400d`, max: 500 });
    const ids = allIds.filter((id) => !seen.has(id));
    console.log(`${allIds.length} candidates | ${seen.size} already measured | ${ids.length} unseen`);
    console.log(`target ${PER} per bucket across ${BUCKETS.length + 1} buckets`);

    const rows = []; const counts = {}; const dropped = [];
    for (const id of ids) {
        if (Object.values(counts).reduce((a, b) => a + b, 0) >= PER * (BUCKETS.length + 1)) break;
        const full = await gmail.getMessage(id);
        if (!full) continue;
        const email = gmail.normalizeMessage(full);
        const b = bucketOf((email.from || '').replace(/.*<|>.*/g, ''));
        if ((counts[b] || 0) >= PER) continue;

        const gate = passesGates(email);
        if (!gate.ok) { dropped.push({ bucket: b, from: email.from, subject: stripSubject(email.subject).slice(0, 70), reason: gate.reason }); continue; }

        counts[b] = (counts[b] || 0) + 1;
        await sleep(PACE);
        const proposals = runPipeline(email, { senderMap, clubIndex });
        const det = detType(proposals[0]);
        await reviewProposals(email, proposals, senderMap, {}, null, clubIndex);
        const p = proposals[0]; const ev = p.evidence || {};
        const r = {
            bucket: b, gmail_id: email.gmail_id,
            from: (email.from || '').replace(/.*<|>.*/g, ''),
            subject: stripSubject(email.subject).replace(/\s+/g, ' ').slice(0, 78),
            deterministic: det, final: detType(p),
            club: p.club || null,
            source: ev.source || '?', llm: ev.source === 'llm' || ev.source === 'llm_fields',
            date: p.payload && (p.payload.startDate || p.payload.event_date) || null,
            time: p.payload && p.payload.time_start || null,
            venue: p.payload && p.payload.venue || null,
            deadline: p.payload && p.payload.deadline || null,
        };
        rows.push(r);
        fs.writeFileSync(OUT + '.partial', JSON.stringify({ rows, dropped }, null, 1));
        console.log(`  ${rows.length} [${b}] ${r.final}  ${r.subject.slice(0, 44)}`);
    }
    fs.writeFileSync(OUT, JSON.stringify({ rows, dropped }, null, 1));
    console.log(`\nclassified ${rows.length} | gate-dropped ${dropped.length}`);
    console.log('per bucket:', JSON.stringify(counts));
    process.exit(0);
})();
