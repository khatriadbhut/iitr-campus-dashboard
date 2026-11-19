/**
 * Build a 20-poster TEST SET that spans the possibility space (both-missing / date-missing / venue-missing;
 * movie screening, recruitment, guest lecture, cultural, workshop, sports/hostel; Hindi/bilingual; relative
 * date in subject; odd venue code; jpg/png/jpeg). Downloads each poster image to posterFixtures/ and writes
 * posterFixtures/manifest.json with the email context + what the TEXT already extracted (ground-truth hooks).
 * Run: node services/eventIngestion/__tests__/buildPosterFixtures.js "after:2026/01/01 before:2026/06/01"
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const gmail = require('../source/gmail');
const { runPipeline, passesGates } = require('../index');

const RANGE = process.argv[2] || 'after:2026/01/01 before:2026/06/01';
const LISTS = 'to:students-notices@iitr.ac.in OR to:ug@iitr.ac.in OR to:pg@iitr.ac.in OR to:ug-1st-year@iitr.ac.in';
const QUERY = `(${LISTS}) ${RANGE}`;
const CONCURRENCY = 6;
const OUT = path.join(__dirname, 'posterFixtures');
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

const topicOf = (s) => /screening|movie|film/i.test(s) ? 'movie'
    : /recruit/i.test(s) ? 'recruitment'
    : /guest (expert )?lecture|guest lecture|talk\b/i.test(s) ? 'lecture'
    : /workshop|masterclass|bootcamp/i.test(s) ? 'workshop'
    : /holi|sankranti|lohri|lantern|bonfire|panchami|cultural|fos\b|darpan|kavya|jashn|feast|play|theatre|dance|comedy/i.test(s) ? 'cultural'
    : /sports|trophy|badminton|trek|fitness|games|marathon|run\b/i.test(s) ? 'sports'
    : 'other';

async function pool(items, n, worker) {
    let i = 0;
    const runNext = async () => { while (i < items.length) { const idx = i++; await worker(items[idx], idx); } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, runNext));
}

(async () => {
    console.log(`query: ${QUERY}`);
    const ids = await gmail.listMessageIds({ query: QUERY, max: 5000 });
    console.log(`fetched ${ids.length} ids — collecting poster candidates…`);

    const cand = [];
    let done = 0;
    await pool(ids, CONCURRENCY, async (id) => {
        let msg; try { msg = await gmail.getMessage(id); } catch { return; }
        if (++done % 150 === 0) console.log(`  …${done}/${ids.length}`);
        const email = gmail.normalizeMessage(msg);
        if (!passesGates(email).ok) return;
        const ev = runPipeline(email, { senderMap: {} }).find((p) => p.mutation_type === 'CREATE_EVENT');
        if (!ev) return;
        const att = gmail.findImageAttachment(msg.payload);
        if (!att || (att.size && (att.size < 20000 || att.size > 5_000_000))) return;
        const pl = ev.payload || {};
        const missing = [];
        if (!pl.startDate) missing.push('date');
        if (!(pl.venue && pl.venue.trim())) missing.push('venue');
        if (!missing.length) return;
        const subj = email.subject || '';
        cand.push({
            id, subject: subj.replace(/\s+/g, ' ').slice(0, 100), from: (email.from || '').split('<')[0].trim().slice(0, 40),
            sentDate: email.internal_date, missing, topic: topicOf(subj),
            hindi: /[ऀ-ॿ]/.test(subj), relDate: /\btoday|tomorrow\b/i.test(subj), oddVenue: /\bAPJ|LHC|-\d{3}\b/i.test(subj),
            det_date: pl.startDate || null, det_venue: pl.venue || null,
            body_excerpt: (email.body_text || '').replace(/\s+/g, ' ').slice(0, 300),
            att: { attachmentId: att.attachmentId, filename: att.filename, mimeType: att.mimeType, size: att.size },
        });
    });
    console.log(`\n${cand.length} poster-gap candidates. Selecting 20 for coverage…`);

    // greedy diversity pick: key by (missing-combo × topic), round-robin, then top up with special features
    const picked = [];
    const seenKey = new Set();
    const keyOf = (c) => `${c.missing.join('+')}|${c.topic}`;
    for (const c of cand) { if (picked.length >= 14) break; const k = keyOf(c); if (!seenKey.has(k)) { seenKey.add(k); picked.push(c); } }
    const want = [(c) => c.hindi, (c) => c.relDate, (c) => c.oddVenue, (c) => c.missing.length === 2, (c) => c.topic === 'movie', (c) => c.topic === 'sports'];
    for (const pred of want) { if (picked.length >= 20) break; const hit = cand.find((c) => pred(c) && !picked.includes(c)); if (hit) picked.push(hit); }
    for (const c of cand) { if (picked.length >= 20) break; if (!picked.includes(c)) picked.push(c); }

    fs.mkdirSync(OUT, { recursive: true });
    const manifest = [];
    let n = 0;
    for (const c of picked) {
        try {
            const buf = await gmail.getAttachment(c.id, c.att.attachmentId);
            if (!buf) continue;
            const file = `${String(++n).padStart(2, '0')}_${c.id}.${EXT[c.att.mimeType] || 'jpg'}`;
            fs.writeFileSync(path.join(OUT, file), buf);
            manifest.push({
                file, id: c.id, subject: c.subject, from: c.from, sentDate: c.sentDate,
                missing: c.missing, topic: c.topic, tags: [c.hindi && 'hindi', c.relDate && 'relDate', c.oddVenue && 'oddVenue'].filter(Boolean),
                text_date: c.det_date, text_venue: c.det_venue, poster_filename: c.att.filename,
                body_excerpt: c.body_excerpt,
                expected: { date: null, venue: null, note: 'fill by eyeballing the poster image if you want a hard assertion' },
            });
        } catch (e) { console.log('skip', c.id, e.message.slice(0, 40)); }
    }
    fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

    console.log(`\nsaved ${manifest.length} posters + manifest → ${OUT}`);
    const tally = {};
    manifest.forEach((m) => { const k = `${m.missing.join('+')}|${m.topic}`; tally[k] = (tally[k] || 0) + 1; });
    console.log('coverage (missing | topic):');
    Object.entries(tally).sort().forEach(([k, v]) => console.log(`   ${k.padEnd(28)} ${v}`));
    console.log('special tags present:', [...new Set(manifest.flatMap((m) => m.tags))].join(', ') || '(none)');
    process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
