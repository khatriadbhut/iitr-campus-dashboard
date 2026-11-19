/**
 * One Gmail pass, cached to disk, so every later question is instant instead of a ten-minute refetch.
 * Stores exactly what the pipeline sees: subject + topMessage/cleanBody text + sender. Read-only.
 */
require('dotenv').config({ quiet: true });
const fs = require('fs');
const B = __dirname + '/..';
const gmail = require(B + '/source/gmail');
const { passesGates, topMessage, cleanBody } = require(B + '/index');
const OUT = process.env.CORPUS_CACHE || '/tmp/corpus.json';
const addr = (f) => { const m = (f || '').match(/<([^>]+)>/); return (m ? m[1] : f || '').toLowerCase().trim(); };
async function pool(items, n, w) { let i = 0; const r = async () => { while (i < items.length) { const k = i++; try { await w(items[k]); } catch (e) { } } }; await Promise.all(Array.from({ length: n }, r)); }
(async () => {
    const ids = await gmail.listMessageIds({ query: 'to:students-notices@iitr.ac.in newer_than:365d', max: 1200 });
    const out = [];
    await pool(ids, 8, async (id) => {
        const e = gmail.normalizeMessage(await gmail.getMessage(id));
        if (!passesGates(e).ok) return;
        // keep the RAW body too: cleanBody strips the sign-off, which is exactly where a club names
        // itself ("Regards, Esports IITR"), so attribution measured on cleaned text under-reports.
        out.push({ subject: e.subject || '', from: addr(e.from), body: cleanBody(topMessage(e.body_text)).text || '', raw: e.body_text || '' });
    });
    fs.writeFileSync(OUT, JSON.stringify(out));
    console.log(`cached ${out.length} emails -> ${OUT}`);
})();
