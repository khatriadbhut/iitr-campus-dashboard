/**
 * Smoke-detector test for the academic-calendar parser.
 *
 * Runs the parser (pure function — no DB, no server) against the real sample
 * PDFs and compares to saved snapshots. Catches the moment a future code change
 * silently breaks an already-supported calendar.
 *
 *   node services/academicCalendar/__tests__/parser.test.js                 # check
 *   UPDATE_SNAPSHOTS=1 node services/academicCalendar/__tests__/parser.test.js  # regenerate
 *
 * Strict on the fields that matter (status, semester, count, every date,
 * category, isHoliday, tentative, which rows are flagged); lenient on cosmetic
 * title text (compared as alphanumerics only), so a trivial wording tweak in the
 * PDF won't false-alarm but a wrong date / missing event always will.
 */

const fs = require('fs');
const path = require('path');
const { parsePdf } = require('../index');

const SAMPLES_DIR = path.resolve(__dirname, '../../../../docs/academic calender samples');
const SNAPSHOT_FILE = path.join(__dirname, 'snapshots.json');

// Expected top-level outcome per sample. Files not listed are ignored.
const EXPECT = {
    'Acad_CalendarFor_All_Programs_Other_than_MBA.pdf': 'ok',
    'Academic_Calendar_-_Spring_Semester_2024-25_Revised.pdf': 'ok',
    'All_Programs_Other_than_MBA_Spring_Calendar_2025-26 (1).pdf': 'ok',
    'Autumn Calander 2026-27 Revised.pdf': 'ok',
    'Autumn_Calander_2026-27_All_Programme_other_than_MBA (1).pdf': 'ok',
    'Academic_Calendar_2026-27-MBA.pdf': 'coming_soon',
    'MBA_Programme_Spring_Calendar_2025-26.pdf': 'coming_soon',
    'Academic_Calendar_Odd2026_27.pdf': 'no_text',
};

const alnum = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The meaningful, order-preserving fingerprint of a parsed calendar.
function fingerprint(report) {
    return {
        status: report.status,
        semester: report.coverage.semester,
        total: report.coverage.total,
        holidays: report.coverage.holidays,
        tentative: report.coverage.tentative,
        flags: report.flags.map((f) => alnum(f.title)).sort(),
        entries: report.entries.map((e) => ({
            t: alnum(e.title),
            s: e.startDate,
            e: e.endDate,
            c: e.category,
            h: e.isHoliday,
            x: e.tentative,
        })),
    };
}

async function reportFor(file) {
    const buf = fs.readFileSync(path.join(SAMPLES_DIR, file));
    return parsePdf(buf);
}

function diffFingerprint(name, expected, actual) {
    const errs = [];
    for (const k of ['status', 'semester', 'total', 'holidays', 'tentative']) {
        if (expected[k] !== actual[k]) errs.push(`${k}: expected ${JSON.stringify(expected[k])}, got ${JSON.stringify(actual[k])}`);
    }
    if (JSON.stringify(expected.flags) !== JSON.stringify(actual.flags)) {
        errs.push(`flags: expected ${JSON.stringify(expected.flags)}, got ${JSON.stringify(actual.flags)}`);
    }
    const n = Math.max(expected.entries.length, actual.entries.length);
    for (let i = 0; i < n; i++) {
        const a = expected.entries[i], b = actual.entries[i];
        if (!a) { errs.push(`entry[${i}]: unexpected extra "${b.t}"`); continue; }
        if (!b) { errs.push(`entry[${i}]: missing "${a.t}"`); continue; }
        for (const k of ['t', 's', 'e', 'c', 'h', 'x']) {
            if (a[k] !== b[k]) errs.push(`entry[${i}] (${a.t}).${k}: expected ${JSON.stringify(a[k])}, got ${JSON.stringify(b[k])}`);
        }
    }
    return errs;
}

(async () => {
    const files = Object.keys(EXPECT);
    const update = process.env.UPDATE_SNAPSHOTS === '1';
    const snapshots = (!update && fs.existsSync(SNAPSHOT_FILE))
        ? JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'))
        : {};

    let failures = 0;
    const newSnapshots = {};

    for (const file of files) {
        const expectStatus = EXPECT[file];
        let report;
        try {
            report = await reportFor(file);
        } catch (err) {
            console.log(`✗ ${file}\n    threw: ${err.code || ''} ${err.message}`);
            failures++;
            continue;
        }

        // 1) status must match expectation for every file
        if (report.status !== expectStatus) {
            console.log(`✗ ${file}\n    status: expected "${expectStatus}", got "${report.status}"`);
            failures++;
            continue;
        }

        // 2) for parseable calendars, compare the full fingerprint to the snapshot
        if (expectStatus === 'ok') {
            const fp = fingerprint(report);
            newSnapshots[file] = fp;
            if (update) {
                console.log(`↻ ${file} — snapshot recorded (${fp.total} events, semester ${fp.semester})`);
                continue;
            }
            const expected = snapshots[file];
            if (!expected) {
                console.log(`✗ ${file}\n    no snapshot found — run with UPDATE_SNAPSHOTS=1`);
                failures++;
                continue;
            }
            const errs = diffFingerprint(file, expected, fp);
            if (errs.length) {
                console.log(`✗ ${file}  (${errs.length} diffs)`);
                errs.slice(0, 12).forEach((e) => console.log(`    ${e}`));
                if (errs.length > 12) console.log(`    …and ${errs.length - 12} more`);
                failures++;
            } else {
                console.log(`✓ ${file} — ${fp.total} events, semester ${fp.semester}, ${fp.flags.length} flagged`);
            }
        } else {
            console.log(`✓ ${file} — ${report.status}${report.reason ? ' (' + report.reason + ')' : ''}`);
        }
    }

    if (update) {
        fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(newSnapshots, null, 2) + '\n');
        console.log(`\nWrote ${Object.keys(newSnapshots).length} snapshots to ${path.relative(process.cwd(), SNAPSHOT_FILE)}`);
        return;
    }

    console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${files.length - failures}/${files.length} checks passed`);
    process.exit(failures === 0 ? 0 : 1);
})();
