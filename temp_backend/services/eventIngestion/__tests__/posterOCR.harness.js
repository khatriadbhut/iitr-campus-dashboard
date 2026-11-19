/**
 * Validate poster reading over the 20-image fixture set. For each poster it runs the SAME two-step recovery
 * the runner uses — (1) date from filename, (2) Gemini vision for the rest — and prints what each field
 * resolved to, so you can eyeball that every case fills correctly. Needs GEMINI_API_KEY.
 * Run: node services/eventIngestion/__tests__/posterOCR.harness.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const gemini = require('../review/gemini');
const { parseDates } = require('../index');

const DIR = path.join(__dirname, 'posterFixtures');

function filenameDate(filename, sentDate) {
    if (!filename) return null;
    const d = parseDates(filename.replace(/[._-]+/g, ' ')).startDate;
    if (!d) return null;
    const days = (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${new Date(sentDate).toISOString().slice(0, 10)}T00:00:00Z`)) / 864e5;
    return (days >= -30 && days <= 400) ? d : null;
}

(async () => {
    if (!gemini.isConfigured()) { console.log('⚠ set GEMINI_API_KEY in .env to run the vision harness.'); process.exit(0); }
    const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
    console.log(`poster OCR harness — ${manifest.length} fixtures, model ${gemini.MODEL}\n`);

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let gapsBefore = 0, gapsFilled = 0;
    for (const m of manifest) {
        await sleep(6000);                                 // ~10/min — under the lite free-tier RPM (retry backstops any 429)
        const buf = fs.readFileSync(path.join(DIR, m.file));
        const mime = m.file.endsWith('.png') ? 'image/png' : 'image/jpeg';
        const need = { date: m.missing.includes('date'), venue: m.missing.includes('venue') };
        gapsBefore += m.missing.length;

        const fnDate = need.date ? filenameDate(m.poster_filename, m.sentDate) : null;
        const g = await gemini.extractFromPoster(buf, mime, { subject: m.subject, sentDate: m.sentDate }) || {};

        const gotDate = m.text_date || fnDate || g.date || null;
        const gotVenue = m.text_venue || g.venue || null;
        if (need.date && gotDate) gapsFilled++;
        if (need.venue && gotVenue) gapsFilled++;

        console.log(`── ${m.file}  [${m.topic}${m.tags.length ? ' · ' + m.tags.join(',') : ''}]  miss:${m.missing.join('+')}`);
        console.log(`   ${m.subject}`);
        console.log(`   date : text=${m.text_date || '—'}  filename=${fnDate || '—'}  vision=${g.date || '—'}${g.end_date ? '→' + g.end_date : ''}  ⇒ ${gotDate || 'STILL MISSING'}`);
        console.log(`   venue: text=${m.text_venue || '—'}  vision=${g.venue || '—'}  ⇒ ${gotVenue || 'STILL MISSING'}`);
        console.log(`   time : vision=${g.time || '—'}`);
    }
    console.log(`\n==== ${gapsFilled}/${gapsBefore} missing fields recovered from posters ====`);
    process.exit(0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
