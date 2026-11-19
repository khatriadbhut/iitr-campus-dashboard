require('dotenv').config();
const { EventProposal, IngestedEmail } = require('../../../database/schemas');

const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
const OPP_CUE = /scholarship|fellowship|freeship|financial assistance|recruit|\bpors?\b|hiring|internship|applications? (open|invited)|apply by|last date to apply/i;

(async () => {
    const props = await EventProposal.findAll({ attributes: ['mutation_type', 'payload', 'evidence'], raw: true });
    const ing = await IngestedEmail.findAll({ attributes: ['state', 'error', 'body_text'], raw: true });

    // ingested / dismissed
    const st = {}, dismissReasons = {}; let privacy = 0;
    for (const e of ing) {
        inc(st, e.state);
        if (e.state === 'dismissed' && e.error) { inc(dismissReasons, e.error.startsWith('privacy:') ? 'privacy(groq)' : e.error); if (e.error.startsWith('privacy:')) privacy++; }
    }

    // proposals
    const mut = {}, kind = {}, codes = {}; let opp = 0, info = 0, ruleStamped = 0, reclass = 0;
    const suspectEvents = [];
    for (const p of props) {
        inc(mut, p.mutation_type);
        const ev = p.evidence || {}; if (ev.rule_version) ruleStamped++; if (ev.reclassified) reclass++;
        for (const c of ev.reason_codes || []) inc(codes, c);
        if (p.mutation_type === 'CREATE_NOTICE') { p.payload.is_opportunity ? opp++ : info++; inc(kind, p.payload.kind || '?'); }
        if (p.mutation_type === 'CREATE_EVENT') {
            const t = p.payload.title || '';
            if (OPP_CUE.test(t)) suspectEvents.push(t.slice(0, 76));   // likely opportunity misfiled as event
        }
    }

    console.log('=== INGESTED EMAILS ===');
    console.log('states:', JSON.stringify(st));
    console.log('privacy-dropped by Groq screen:', privacy);
    console.log('dismiss reasons:', JSON.stringify(dismissReasons, null, 0));
    console.log('\n=== PROPOSALS ===', JSON.stringify(mut), `| rule_version stamped: ${ruleStamped}/${props.length} | reclassified: ${reclass}`);
    console.log(`notices → opportunity: ${opp}  info: ${info}`);
    console.log('notice kinds:', JSON.stringify(kind));
    console.log('reason codes:', JSON.stringify(codes));
    console.log(`\n=== SUSPECT: events whose TITLE has an apply/scholarship/recruit cue (likely misfiled): ${suspectEvents.length} of ${mut.CREATE_EVENT} events ===`);
    suspectEvents.slice(0, 30).forEach((t) => console.log('  ⚠️ ', t));

    // random samples for hand-scoring
    const rand = (arr, n) => { const c = [...arr]; const out = []; let seed = 12345; while (out.length < n && c.length) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; out.push(c.splice(seed % c.length, 1)[0]); } return out; };
    const evTitles = props.filter((p) => p.mutation_type === 'CREATE_EVENT').map((p) => p.payload.title);
    const noTitles = props.filter((p) => p.mutation_type === 'CREATE_NOTICE').map((p) => `[${p.payload.is_opportunity ? 'OPP' : 'INFO'}/${p.payload.kind}] ${p.payload.title}`);
    console.log('\n=== RANDOM 15 EVENTS ==='); rand(evTitles, 15).forEach((t) => console.log('  •', (t || '').slice(0, 82)));
    console.log('\n=== RANDOM 15 NOTICES ==='); rand(noTitles, 15).forEach((t) => console.log('  •', (t || '').slice(0, 88)));
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
