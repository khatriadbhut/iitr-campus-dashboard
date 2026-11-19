/**
 * Teaching-day extraction, against the real calendar PDFs in docs/academic calender samples.
 *
 * Run from temp_backend/: node services/academicCalendar/__tests__/teachingDays.test.js
 * Needs `pdftotext` (poppler) on PATH — skips cleanly with a notice if absent, so it never fails a
 * machine that simply lacks the binary.
 *
 * The expectations below were read off the documents by eye, not produced by this code.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { extractTeachingDays } = require('../teachingDays');

const DIR = path.join(__dirname, '../../../../docs/academic calender samples');

// null = the layout should yield NOTHING. That is a real assertion, not an absence of one: showing a
// wrong total is worse than showing none, so "we correctly gave up" is the behaviour under test.
const EXPECT = {
    // Autumn layout — totals labelled, UG I year listed separately because it starts late.
    'Autumn Calander 2026-27 Revised.pdf': { others: 72, ugFirstYear: 69 },
    'Autumn_Calander_2026-27_All_Programme_other_than_MBA (1).pdf': { others: 72, ugFirstYear: 69 },
    // The source of the `70` that sat hardcoded in Calendar.jsx — a real figure from an older semester.
    'Acad_CalendarFor_All_Programs_Other_than_MBA.pdf': { others: 70, ugFirstYear: 68 },
    // Spring layout — no separate intake, so a bare grand total. 13+20+13+22+2 = 70 and 15+19+15+21 = 70.
    'All_Programs_Other_than_MBA_Spring_Calendar_2025-26 (1).pdf': { others: 70, ugFirstYear: null },
    'Academic_Calendar_-_Spring_Semester_2024-25_Revised.pdf': { others: 70, ugFirstYear: null },
    // MBA calendars are a different document the pipeline declines anyway.
    'MBA_Programme_Spring_Calendar_2025-26.pdf': null,
    'Academic_Calendar_2026-27-MBA.pdf': null,
};

try {
    execFileSync('which', ['pdftotext']);
} catch {
    console.log('SKIP teachingDays.test.js — pdftotext (poppler) not on PATH');
    process.exit(0);
}

let pass = 0, fail = 0;
for (const [file, want] of Object.entries(EXPECT)) {
    const full = path.join(DIR, file);
    if (!fs.existsSync(full)) { console.log(`⚠️  missing sample: ${file}`); continue; }
    const text = execFileSync('pdftotext', ['-layout', full, '-'], { maxBuffer: 20e6 }).toString();
    const got = extractTeachingDays([text]);
    const ok = want === null
        ? got === null
        : !!got && got.others === want.others && (got.ugFirstYear ?? null) === (want.ugFirstYear ?? null);
    const show = got ? `${got.others}/${got.ugFirstYear ?? '-'}` : 'null';
    if (ok) { pass++; console.log(`✅ ${file.slice(0, 52)} → ${show}`); }
    else { fail++; console.log(`❌ ${file.slice(0, 52)} → ${show}, want ${want ? `${want.others}/${want.ugFirstYear ?? '-'}` : 'null'}`); }
}

// A total must never be accepted from junk, however calendar-shaped the junk looks.
const junk = [`Teaching days for Spring Semester 9999-00\nTotal\n  1   2   3\ndays\nExaminations`];
if (extractTeachingDays(junk) === null) { pass++; console.log('✅ refuses a total that reconciles to nothing plausible'); }
else { fail++; console.log('❌ accepted an implausible total from junk'); }

if (extractTeachingDays(['no calendar here at all']) === null) { pass++; console.log('✅ returns null when the header is absent'); }
else { fail++; console.log('❌ invented a figure with no header present'); }

console.log(`\n${pass}/${pass + fail} passed.`);
if (fail) process.exit(1);
