/**
 * Do NOTICE emails carry a poster that adds information, or one that just re-states the text?
 *
 * Pulls real broadcast mail, keeps only what the pipeline classifies as CREATE_NOTICE, and for each
 * records whether an image is attached and what the TEXT already gave us. Saves every notice-poster to
 * disk so they can be eyeballed against the email body.
 *
 * Read-only: no DB writes, no proposals. Run: node .../noticePosterAudit.js [targetNoticeCount]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const gmail = require('../source/gmail');
const { runPipeline, passesGates, extract, stripSubject, cleanBody, topMessage } = require('../index');

const TARGET = Number(process.argv[2]) || 100;
const OUT = process.argv[3] || '/private/tmp/claude-501/-Users-adbhut-Campus-Dashboard-Event-Planner/ac91cb0a-d57e-4d6a-a4d7-84f3a9d57247/scratchpad/notice-posters';
const LISTS = 'to:students-notices@iitr.ac.in OR to:ug@iitr.ac.in OR to:pg@iitr.ac.in OR to:ug-1st-year@iitr.ac.in';

const pool = async (items, n, worker) => {
    let i = 0;
    const run = async () => { while (i < items.length) { const idx = i++; try { await worker(items[idx], idx); } catch (e) { /* keep going */ } } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
};

(async () => {
    if (!gmail.isConfigured()) { console.error('Gmail not configured'); process.exit(1); }
    fs.mkdirSync(OUT, { recursive: true });

    // pull generously — only a fraction become notices, and fewer still carry an image
    const ids = await gmail.listMessageIds({ query: `(${LISTS}) newer_than:400d`, max: 500 });
    console.log(`fetched ${ids.length} message ids`);

    const notices = [];
    let scanned = 0, dropped = 0, events = 0, other = 0;

    await pool(ids, 6, async (id) => {
        if (notices.length >= TARGET * 3) return;
        const full = await gmail.getMessage(id);
        if (!full) return;
        const email = gmail.normalizeMessage(full);
        scanned++;
        if (!passesGates(email).ok) { dropped++; return; }
        const p = runPipeline(email, { senderMap: {}, clubIndex: [] })[0];
        if (p.mutation_type === 'CREATE_EVENT') { events++; return; }
        if (p.mutation_type !== 'CREATE_NOTICE') { other++; return; }

        const att = gmail.findImageAttachment(full.payload);
        const f = extract(email);
        const cleaned = cleanBody(topMessage(email.body_text));
        notices.push({
            gmail_id: email.gmail_id,
            subject: stripSubject(email.subject).replace(/\s+/g, ' ').slice(0, 90),
            from: (email.from || '').replace(/.*<|>.*/g, '').slice(0, 40),
            kind: p.payload.kind,
            is_opportunity: !!p.payload.is_opportunity,
            body_chars: cleaned.text.length,
            detail_in_attachment: !!f.detailInAttachment,
            reason_codes: (p.evidence && p.evidence.reason_codes) || [],
            text_date: f.startDate || null,
            text_deadline: f.registration_deadline || p.payload.deadline || null,
            text_time: f.time_start || null,
            text_venue: f.venue || null,
            has_image: !!att,
            image: att ? { filename: att.filename, size: att.size, mimeType: att.mimeType, attachmentId: att.attachmentId } : null,
        });
    });

    notices.sort((a, b) => (b.has_image ? 1 : 0) - (a.has_image ? 1 : 0));
    const withImg = notices.filter((n) => n.has_image);
    console.log(`\nscanned ${scanned} | gate-dropped ${dropped} | events ${events} | other ${other} | NOTICES ${notices.length}`);
    console.log(`notices carrying an image: ${withImg.length}`);

    // download every notice poster so it can actually be looked at
    let saved = 0;
    await pool(withImg.slice(0, 40), 4, async (n, i) => {
        const buf = await gmail.getAttachment(n.gmail_id, n.image.attachmentId);
        if (!buf) return;
        const ext = (n.image.mimeType || '').includes('png') ? 'png' : (n.image.mimeType || '').includes('webp') ? 'webp' : 'jpg';
        const file = `${String(i + 1).padStart(2, '0')}_${n.gmail_id}.${ext}`;
        fs.writeFileSync(path.join(OUT, file), buf);
        n.saved_as = file;
        saved++;
    });
    console.log(`saved ${saved} poster images → ${OUT}`);

    fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(notices, null, 1));
    console.log('wrote audit.json');
})();
