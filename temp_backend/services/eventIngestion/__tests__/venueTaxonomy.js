/**
 * VENUE TAXONOMY — a year of broadcast mail, read-only, reports only.
 *
 * Purpose: see how people actually WRITE a venue, so a normalising format can be designed from evidence
 * instead of guesswork. Deliberately deterministic (no Groq): we want the RAW expressions as they appear
 * in the text, not a model's cleaned-up reading of them.
 *
 * Emits: how the venue is introduced (the cue), every distinct raw value with counts, a first-pass
 * bucketing, and — the useful part — everything that falls through the buckets.
 *
 * Run from temp_backend/: node services/eventIngestion/__tests__/venueTaxonomy.js "<query>" [N]
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const gmail = require('./../source/gmail');
const { passesGates, topMessage, cleanBody } = require('./../index');

const QUERY = process.argv[2] || 'to:students-notices@iitr.ac.in newer_than:365d';
const N = Number(process.argv[3] || 1200);

// How a venue gets introduced. Captured separately so we can see which cues actually earn their keep.
const CUES = [
    ['label', /^\s*(?:\*\*)?\s*(?:venue|vanue|location|place|where)\s*(?:\*\*)?\s*[:\-–]\s*(.+)$/im],
    ['emoji', /📍\s*(?:venue\s*[:\-–]\s*)?(.+)/i],
    ['at', /\b(?:will be held|to be held|shall be held|is scheduled)\s+(?:at|in)\s+([^.,;\n]{3,60})/i],
    ['venue_is', /\bvenue\s+(?:is|will be)\s+([^.,;\n]{3,60})/i],
];

// First-pass buckets, ordered — most specific first.
const BUCKETS = [
    ['online', /^\s*(online|virtual|zoom|google meet|ms teams|teams|webex|hybrid)\b|meeting link|microsoft teams/i],
    ['room-in-block', /\b(apj|apjakb|apj-?akb|lhc|gb|ge|nlhc)\b[\s\-–]*\d{2,4}\b/i],
    ['block-only', /^\s*(apj|apjakb|apj-?akb|lhc|gb|sac|ntb|lbs)\s*[-–]?\s*$/i],
    ['auditorium', /\b(auditorium|audi\b|convocation hall|senate hall|mac\b)/i],
    ['ground-sports', /\b(ground|stadium|field|court|pool|gym|track)\b/i],
    ['department', /\b(department|dept\.?|school of|centre for|center for|wrdm|mied|bsbe|csed|ece|civil|chemistry|physics|hydrology)\b/i],
    ['named-building', /\b(sac|ntb|new technology block|gargi block|saraswati mandir|mgcl|library|bhawan|block)\b/i],
    ['off-campus', /\b(new delhi|delhi|mumbai|kanpur|raipur|chhattisgarh|bengaluru|iit (bombay|delhi|kanpur|madras)|nit\b|rashtrapati)\b/i],
    ['tba-vague', /^\s*(tba|tbd|to be (announced|decided)|respective campuses|campus|iit roorkee(,? india)?)\s*$/i],
];

const bucketOf = (v) => (BUCKETS.find(([, re]) => re.test(v)) || ['UNCATEGORISED'])[0];

async function pool(items, n, worker) {
    let i = 0;
    const run = async () => { while (i < items.length) { const idx = i++; try { await worker(items[idx]); } catch (e) { } } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

(async () => {
    const ids = await gmail.listMessageIds({ query: QUERY, max: N });
    console.log(`reading ${ids.length} emails (deterministic — raw text, no model)\n`);
    const byCue = {}; const raw = new Map(); let scanned = 0, withVenue = 0;

    await pool(ids, 6, async (id) => {
        const email = gmail.normalizeMessage(await gmail.getMessage(id));
        if (!passesGates(email).ok) return;
        scanned++;
        const text = cleanBody(topMessage(email.body_text)).text;
        let found = null, cueName = null;
        for (const [name, re] of CUES) {
            const m = re.exec(text);
            if (m && m[1]) { found = m[1]; cueName = name; break; }
        }
        if (!found) return;
        const v = found.replace(/\s+/g, ' ').replace(/[)\].,;]+$/, '').trim().slice(0, 70);
        if (v.length < 2) return;
        withVenue++;
        byCue[cueName] = (byCue[cueName] || 0) + 1;
        raw.set(v, (raw.get(v) || 0) + 1);
    });

    const rows = [...raw.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`emails published: ${scanned}   ·   with a stated venue: ${withVenue}   ·   distinct strings: ${rows.length}\n`);
    console.log('HOW THE VENUE IS INTRODUCED');
    Object.entries(byCue).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));

    const buckets = {};
    for (const [v, n] of rows) (buckets[bucketOf(v)] = buckets[bucketOf(v)] || []).push([v, n]);
    console.log('\nBUCKETS (distinct strings / total mentions)');
    Object.entries(buckets)
        .sort((a, b) => b[1].reduce((s, x) => s + x[1], 0) - a[1].reduce((s, x) => s + x[1], 0))
        .forEach(([k, list]) => console.log(`  ${String(list.length).padStart(3)} / ${String(list.reduce((s, x) => s + x[1], 0)).padStart(4)}  ${k}`));

    for (const [k, list] of Object.entries(buckets)) {
        console.log(`\n── ${k} ──`);
        list.slice(0, 30).forEach(([v, n]) => console.log(`  ${String(n).padStart(3)}  ${v}`));
        if (list.length > 30) console.log(`  … ${list.length - 30} more`);
    }
    fs.writeFileSync('/tmp/venueTaxonomy.json', JSON.stringify({ byCue, rows, buckets }, null, 1));
    console.log('\nfull data -> /tmp/venueTaxonomy.json');
})();
