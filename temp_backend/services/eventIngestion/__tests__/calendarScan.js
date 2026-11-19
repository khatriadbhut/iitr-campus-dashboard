/**
 * Pull a YEAR of calendar-class broadcast emails and dump subject + body snippet, so we can judge:
 * does email ever ADD a calendar item not in the PDF calendar, or only AMEND existing ones?
 * Run: node …/calendarScan.js  → writes calendarScan.out.txt
 */
require('dotenv').config();
const fs = require('fs');
const gmail = require('../source/gmail');

const LISTS = 'to:students-notices@iitr.ac.in OR to:ug@iitr.ac.in OR to:pg@iitr.ac.in';
// calendar-class: calendar senders OR calendar-ish subjects
const CAL = 'from:aao-timetable@iitr.ac.in OR from:arcurriculum@iitr.ac.in OR from:donotreply-acad@iitr.ac.in OR subject:holiday OR subject:"teaching day" OR subject:reschedul OR subject:"academic calendar" OR subject:"time table" OR subject:"time-table" OR subject:"exam schedule" OR subject:"re-examination" OR subject:"re examination" OR subject:"schedule of classes" OR subject:"mid term" OR subject:"end term" OR subject:MTE OR subject:ETE';
const QUERY = `(${LISTS}) (${CAL}) after:2024/07/01 before:2026/07/25`;

async function pool(items, n, w) { let i = 0; const run = async () => { while (i < items.length) { await w(items[i++]); } }; await Promise.all(Array.from({ length: n }, run)); }

(async () => {
    const ids = await gmail.listMessageIds({ query: QUERY, max: 5000 });
    const rows = [];
    await pool(ids, 6, async (id) => {
        let e; try { e = gmail.normalizeMessage(await gmail.getMessage(id)); } catch { return; }
        const from = (e.from || '').replace(/<.*/, '').trim();
        const body = (e.body_text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
        const date = e.internal_date ? new Date(e.internal_date).toISOString().slice(0, 10) : '????';
        rows.push({ date, from, subject: (e.subject || '').trim(), body });
    });
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const out = [`${rows.length} calendar-class emails (Jul 2024 – Jul 2026)\n`];
    rows.forEach((r) => out.push(`[${r.date}] ${r.from}\n  SUBJ: ${r.subject}\n  BODY: ${r.body}\n`));
    fs.writeFileSync(`${__dirname}/calendarScan.out.txt`, out.join('\n'));
    console.log(`wrote ${rows.length} rows → calendarScan.out.txt`);
    process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
