/* Dev-only: run the parser over the sample PDFs and print results. Not shipped. */
const fs = require('fs');
const path = require('path');
const { parsePdf } = require('../index');

const DIR = path.resolve(__dirname, '../../../../docs/academic calender samples');

(async () => {
    const files = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.pdf'));
    for (const f of files.sort()) {
        const buf = fs.readFileSync(path.join(DIR, f));
        let rep;
        try {
            rep = await parsePdf(buf);
        } catch (e) {
            console.log(`\n### ${f}\n  ERROR: ${e.code || ''} ${e.message}`);
            continue;
        }
        console.log(`\n### ${f}`);
        console.log(`  status=${rep.status}${rep.reason ? ' reason=' + rep.reason : ''}`);
        if (rep.status !== 'ok') continue;
        console.log(`  semester=${rep.coverage.semester}  total=${rep.coverage.total}  holidays=${rep.coverage.holidays}  tentative=${rep.coverage.tentative}  flagged=${rep.coverage.flagged}`);
        if (rep.warnings.length) console.log('  warnings: ' + rep.warnings.join(' | '));
        if (rep.flags.length) console.log('  FLAGS: ' + rep.flags.map((x) => x.title).join(' ; '));
        if (rep.meta.unknownTitles && rep.meta.unknownTitles.length) {
            console.log('  unknown-category titles: ' + rep.meta.unknownTitles.join(' | '));
        }
        for (const e of rep.entries) {
            console.log(`   [${String(e.sortOrder).padStart(2)}] ${e.startDate || 'TBD       '}${e.endDate && e.endDate !== e.startDate ? '..' + e.endDate : ''}  ${e.category.padEnd(20)} ${e.isHoliday ? 'H ' : '  '}${e.tentative ? '🟡 ' : '  '}${e.title.slice(0, 55)}`);
        }
    }
})();
