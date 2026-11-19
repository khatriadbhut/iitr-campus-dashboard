/* Dev-only DB integration test. Requires DATABASE_URL to a THROWAWAY database. */
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../../../database/schemas');
const initializeSchema = require('../../../database/initializeSchema');
const seed = require('../../../database/seedAcademicCalendar');
const store = require('../store');
const { parsePdf } = require('../index');

const SAMPLES = path.resolve(__dirname, '../../../../docs/academic calender samples');
let failures = 0;
function assert(cond, msg) {
    if (cond) { console.log('  ✓ ' + msg); }
    else { console.log('  ✗ ' + msg); failures++; }
}

(async () => {
    console.log('→ init schema + seed');
    await initializeSchema();
    await seed();

    console.log('\n[1] seed');
    const seeded = await store.getServedEntries({});
    assert(seeded.length > 0, `seed populated ${seeded.length} entries`);
    const pub = store.toPublic(seeded[0]);
    assert('startDate' in pub && 'isHoliday' in pub && !('start_date' in pub), 'toPublic() maps to legacy shape');

    console.log('\n[2] parse + commit a real PDF');
    const buf = fs.readFileSync(path.join(SAMPLES, 'Autumn Calander 2026-27 Revised.pdf'));
    const rep = await parsePdf(buf);
    assert(rep.status === 'ok', `parsed Autumn 2026-27 (status=${rep.status})`);
    const commit = await store.commitCalendar({ semester: rep.meta.semester, entries: rep.entries, coverage: rep.coverage, strategy: 'test' });
    assert(commit.count === rep.entries.length, `committed ${commit.count} entries`);

    console.log('\n[3] current calendar switched');
    const cur = await store.getServedEntries({});
    assert(cur.length && cur[0].semester === 'Autumn 2026-27', `current = Autumn 2026-27 (${cur.length} entries)`);
    assert(cur.every((r) => r.start_date !== null || r.tentative), 'served rows have dates (TBD kept only as tentative)');

    console.log('\n[4] revision replaces cleanly (no dupes)');
    await store.commitCalendar({ semester: rep.meta.semester, entries: rep.entries, coverage: rep.coverage, strategy: 'test-revision' });
    const cur2 = await store.getServedEntries({ semester: 'Autumn 2026-27' });
    assert(cur2.length === rep.entries.length, `revision kept count stable at ${cur2.length}`);

    console.log('\n[5] history retained');
    const past = await store.getServedEntries({ semester: 'Spring 2025-26' });
    assert(past.length > 0, `past semester (seed) still queryable: ${past.length}`);
    const sems = await store.listSemesters();
    assert(sems.includes('Autumn 2026-27') && sems.includes('Spring 2025-26'), `semesters: ${sems.join(', ')}`);

    console.log('\n[6] rollback');
    const imports = await store.listImports({});
    const prevGood = imports.find((i) => i.semester === 'Autumn 2026-27' && i.status === 'superseded');
    assert(!!prevGood, 'found a superseded Autumn import to roll back to');
    await store.commitCalendar({ semester: 'Autumn 2026-27', entries: [{ title: 'BAD IMPORT', category: 'Academic', startDate: '2026-08-01', endDate: '2026-08-01', isHoliday: false }], strategy: 'bad' });
    const bad = await store.getServedEntries({ semester: 'Autumn 2026-27' });
    assert(bad.length === 1, `bad import shrank calendar to ${bad.length}`);
    await store.rollbackToImport(prevGood.id);
    const restored = await store.getServedEntries({ semester: 'Autumn 2026-27' });
    assert(restored.length === rep.entries.length, `rollback restored ${restored.length} entries`);

    await sequelize.close();
    console.log(`\n${failures === 0 ? 'INTEGRATION PASSED' : 'INTEGRATION FAILED (' + failures + ')'}`);
    process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
