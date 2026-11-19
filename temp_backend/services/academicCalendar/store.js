/**
 * DB persistence for the academic calendar: atomic upsert-by-key, rollback, and
 * the serve/serialize helpers. This is the only module in the pipeline that
 * touches the database — the parser stays pure.
 */

const { Op } = require('sequelize');
const { sequelize, AcademicCalendarEntry, AcademicCalendarImport } = require('../../database/schemas');

const DEFAULTS = { institution: 'IITR', program: 'general' };
// Keep only the N most recent versions per semester so the version list doesn't
// overpopulate with publish/test churn. Older ones (and their rollback snapshots)
// are pruned. The current committed version is always newest, so always kept.
const KEEP_IMPORTS = Number(process.env.ACAL_KEEP_IMPORTS || 5);

function slug(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'entry';
}

// Map a normalized entry → an academic_calendar_entry row.
function toRow(e, { institution, semester, program, importId, index }) {
    return {
        // id is scoped by institution+program+semester so entries from different
        // semesters never collide on the primary key. e.id honoured when present
        // (e.g. the legacy seed's stable ids).
        id: e.id || `${slug(institution)}-${slug(program)}-${slug(semester)}-${slug(e.title)}-${e.startDate || 'tbd'}-${index + 1}`,
        institution,
        semester,
        program,
        title: e.title,
        category: e.category || 'Academic',
        start_date: e.startDate || null,
        end_date: e.endDate || e.startDate || null,
        description: e.description || e.title,
        is_holiday: !!e.isHoliday,
        tentative: !!e.tentative,
        raw_date_text: e.rawDateText || null,
        source_import_id: importId,
        sort_order: e.sortOrder || index + 1,
    };
}

/**
 * Atomically replace the calendar for a {institution, semester, program} key:
 * supersede prior import → insert new import row → replace all entries. Any
 * failure rolls back, leaving the previous calendar untouched.
 */
async function commitCalendar({ institution = DEFAULTS.institution, program = DEFAULTS.program, semester, entries, strategy, uploadedBy = null, sourceFilename = null, coverage = null }) {
    if (!semester) {
        const err = new Error('A semester is required to publish the calendar.');
        err.code = 'MISSING_SEMESTER';
        throw err;
    }
    if (!Array.isArray(entries) || entries.length === 0) {
        const err = new Error('No entries to publish.');
        err.code = 'EMPTY_ENTRIES';
        throw err;
    }

    return sequelize.transaction(async (t) => {
        await AcademicCalendarImport.update(
            { status: 'superseded' },
            { where: { institution, semester, program, status: 'committed' }, transaction: t }
        );
        const imp = await AcademicCalendarImport.create({
            institution, semester, program,
            status: 'committed',
            strategy: strategy || null,
            uploaded_by: uploadedBy,
            source_filename: sourceFilename,
            parsed_snapshot: { entries },
            coverage,
        }, { transaction: t });

        // Replace only PDF-sourced rows — email-amended/added day-status rows PERSIST across a re-import
        // (they're the live "latest reality"; the admin reconciles a genuine conflict in review).
        await AcademicCalendarEntry.destroy({ where: { institution, semester, program, source: { [Op.ne]: 'email' } }, transaction: t });
        const rows = entries.map((e, index) => toRow(e, { institution, semester, program, importId: imp.id, index }));
        await AcademicCalendarEntry.bulkCreate(rows, { transaction: t, validate: true });

        // Retention: prune older versions beyond the most recent KEEP_IMPORTS.
        const recent = await AcademicCalendarImport.findAll({
            where: { institution, semester, program },
            order: [['id', 'DESC']],
            attributes: ['id'],
            limit: KEEP_IMPORTS,
            transaction: t,
        });
        const keepIds = recent.map((r) => r.id);
        if (keepIds.length) {
            await AcademicCalendarImport.destroy({
                where: {
                    institution, semester, program,
                    id: { [Op.notIn]: keepIds },
                    status: { [Op.ne]: 'committed' }, // never prune a semester's final/live version
                },
                transaction: t,
            });
        }

        return { importId: imp.id, count: rows.length, semester, program };
    });
}

/** Re-publish a previous import's snapshot (the admin "Revert to previous" button). */
async function rollbackToImport(importId) {
    const imp = await AcademicCalendarImport.findByPk(importId);
    if (!imp) {
        const err = new Error('That import no longer exists.');
        err.code = 'IMPORT_NOT_FOUND';
        throw err;
    }
    const entries = (imp.parsed_snapshot && imp.parsed_snapshot.entries) || [];
    return commitCalendar({
        institution: imp.institution,
        program: imp.program,
        semester: imp.semester,
        entries,
        strategy: 'rollback',
        sourceFilename: `rollback of import #${importId}`,
        coverage: imp.coverage,
    });
}

/** Rows for the current (default) or a specific semester, in display order. */
async function getServedEntries({ institution = DEFAULTS.institution, program = DEFAULTS.program, semester } = {}) {
    const where = { institution, program };
    if (semester) {
        where.semester = semester;
    } else {
        const latest = await AcademicCalendarImport.findOne({
            where: { institution, program, status: 'committed' },
            order: [['created_at', 'DESC']],
        });
        if (!latest) return [];
        where.semester = latest.semester;
    }
    return AcademicCalendarEntry.findAll({ where, order: [['sort_order', 'ASC']] });
}

/**
 * The committed import's own summary for a semester — currently the teaching-day totals the PDF
 * states about itself, which cannot be derived by counting days (see teachingDays.js). Kept beside
 * the entries rather than recomputed, so uploading a new calendar updates the figure by itself.
 * Returns null when nothing was committed or the layout yielded no total.
 */
async function getServedCoverage({ institution = DEFAULTS.institution, program = DEFAULTS.program, semester } = {}) {
    const where = { institution, program, status: 'committed' };
    if (semester) where.semester = semester;
    const imp = await AcademicCalendarImport.findOne({ where, order: [['created_at', 'DESC']] });
    return imp?.coverage || null;
}

/** Distinct semesters available (for the "view past/upcoming" picker). */
async function listSemesters({ institution = DEFAULTS.institution, program = DEFAULTS.program } = {}) {
    const rows = await AcademicCalendarEntry.findAll({
        attributes: [[sequelize.fn('DISTINCT', sequelize.col('semester')), 'semester']],
        where: { institution, program },
        raw: true,
    });
    return rows.map((r) => r.semester);
}

/** Import history for the rollback UI. */
async function listImports({ institution = DEFAULTS.institution, program = DEFAULTS.program, limit = 20 } = {}) {
    return AcademicCalendarImport.findAll({
        where: { institution, program },
        order: [['created_at', 'DESC']],
        limit,
        attributes: ['id', 'semester', 'status', 'strategy', 'uploaded_by', 'source_filename', 'coverage', 'created_at'],
    });
}

// Editable serializer — maps a DB row to the preview editor's entry shape (keeps
// internal fields the public feed drops: tentative, rawDateText, sortOrder).
function toEditable(row) {
    return {
        id: row.id,
        title: row.title,
        category: row.category,
        startDate: row.start_date,
        endDate: row.end_date,
        description: row.description,
        isHoliday: row.is_holiday,
        tentative: row.tentative,
        rawDateText: row.raw_date_text,
        sortOrder: row.sort_order,
    };
}

// The current (latest-committed) calendar in editable form — for the admin
// "Edit current calendar" flow. Includes ALL rows (even undated/TBD ones the
// public feed hides), so nothing is silently lost when editing.
async function getCurrentEditable(opts = {}) {
    const rows = await getServedEntries(opts);
    if (!rows.length) return null;
    const first = rows[0];
    return {
        institution: first.institution,
        program: first.program,
        semester: first.semester,
        entries: rows.map(toEditable),
    };
}

// Public serializer — maps a DB row to the EXACT legacy shape the frontend expects.
function toPublic(row) {
    return {
        id: row.id,
        title: row.title,
        category: row.category,
        startDate: row.start_date,
        endDate: row.end_date,
        description: row.description,
        isHoliday: row.is_holiday,
        // additive, non-breaking: lets the calendar mark uncertain dates as TBD
        tentative: row.tentative,
    };
}

module.exports = {
    commitCalendar,
    rollbackToImport,
    getServedEntries,
    getServedCoverage,
    getCurrentEditable,
    listSemesters,
    listImports,
    toPublic,
    toEditable,
};
