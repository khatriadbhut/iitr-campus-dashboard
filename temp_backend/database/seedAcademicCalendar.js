/**
 * One-time seed: import the legacy hardcoded calendar (`data/academicCalendar.js`)
 * into the new tables so the DB-backed GET returns the same data on first boot.
 * Idempotent — skips if any entries already exist.
 */

const { AcademicCalendarEntry } = require('./schemas');
const { commitCalendar } = require('../services/academicCalendar/store');

async function seedAcademicCalendar() {
    try {
        const existing = await AcademicCalendarEntry.count();
        if (existing > 0) return; // already seeded, or a real import has run

        let legacy;
        try {
            legacy = require('../data/academicCalendar');
        } catch (_) {
            return; // legacy file already retired — nothing to seed
        }
        if (!Array.isArray(legacy) || legacy.length === 0) return;

        // The legacy file is the Spring 2025-26 general calendar; reuse its ids verbatim.
        const entries = legacy.map((e, i) => ({
            id: e.id,
            title: e.title,
            category: e.category || 'Academic',
            startDate: e.startDate || null,
            endDate: e.endDate || e.startDate || null,
            description: e.description || e.title,
            isHoliday: !!e.isHoliday,
            tentative: false,
            rawDateText: null,
            sortOrder: i + 1,
        }));

        await commitCalendar({
            institution: 'IITR',
            program: 'general',
            semester: 'Spring 2025-26',
            entries,
            strategy: 'legacy-seed',
            sourceFilename: 'data/academicCalendar.js',
            coverage: { total: entries.length, seeded: true },
        });
        console.log(`✅ Seeded academic calendar (${entries.length} entries) from legacy file`);
    } catch (err) {
        // Non-fatal: seeding failure shouldn't stop the server from booting.
        console.error('⚠️ Academic calendar seed skipped:', err.message);
    }
}

module.exports = seedAcademicCalendar;
