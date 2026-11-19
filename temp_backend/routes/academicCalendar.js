const express = require('express');
const multer = require('multer');
const router = express.Router();

const { parsePdf } = require('../services/academicCalendar');
const store = require('../services/academicCalendar/store');
const { Club } = require('../database/schemas');
const { checkAcademicCalendarPermission } = require('../middlewares/permissions/academicCalendar');
const { Joi, validateBody, validateParams, id } = require('../middlewares/validate');
const commitBody = Joi.object({
    institution: Joi.string().trim().max(120),
    program: Joi.string().trim().max(120),
    semester: Joi.string().trim().max(120),
    entries: Joi.array().items(Joi.object().unknown(true)),
    coverage: Joi.object().unknown(true),
    filename: Joi.string().trim().max(300).allow(null, ''),
}).unknown(true);
const importIdParam = Joi.object({ id: id.required() });


// ── upload handling: PDF in memory only (parsed, then discarded) ────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 }, // 8 MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname)) return cb(null, true);
        cb(Object.assign(new Error('Only PDF files are accepted.'), { code: 'NOT_PDF' }));
    },
});

// Wrap multer so its errors become clean JSON instead of a generic 500.
function uploadPdf(req, res, next) {
    upload.single('file')(req, res, (err) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large', message: 'The PDF must be under 8 MB.' });
        if (err.code === 'NOT_PDF') return res.status(400).json({ error: 'Not a PDF', message: err.message });
        return res.status(400).json({ error: 'Upload failed', message: err.message });
    });
}

const serverError = (res, error) => {
    console.error('Academic calendar error:', error);   // detail stays server-side
    return res.status(500).json({ error: 'Internal server error' });
};

// User-facing messages for the non-parseable preview outcomes.
const STATUS_MESSAGES = {
    coming_soon: {
        mba: 'Support for the MBA academic calendar is coming soon. Right now only the general (non-MBA) academic calendar can be uploaded.',
        'other-format': 'Support for this calendar is coming soon. Right now only the general (non-MBA) academic calendar can be uploaded.',
    },
    no_text: 'This PDF has no readable text (it may be a scan). Please upload a text-based calendar PDF, or enter the dates manually.',
    unrecognized: 'Unrecognized document. We couldn\'t read this file as an IIT Roorkee academic calendar. Please upload the official calendar PDF. No changes have been made.',
    uncertain: 'We couldn\'t confidently recognize this as the general academic calendar. Please double-check it\'s the right PDF, or set the details manually.',
};

// ── PUBLIC READS (backward-compatible; no auth, same as before) ─────────────────

// Most calendar rows genuinely belong to nobody — a holiday, an exam window, a registration deadline.
// A few DO name a club that runs them: "Thomso 2026", "Sangram 2026", "Cognizance-2026 Tentative".
// Without a club_id on those, the feed's "hide clubs I don't follow" test is
// `notPreferredClubIds.has(Number(ev.club_id))` → `has(NaN)` → always false, so un-following Thomso
// left "Thomso 2026" sitting in the feed with an Institute avatar and no way to remove it.
//
// Deliberately conservative — a WHOLE-WORD match on the club's name, and never 'Institute':
//   "Thomso 2026"                 → Thomso        ✓
//   "Cognizance-2026 Tentative"   → Cognizance    ✓ (the hyphen is a word boundary)
//   "Institute Foundation Day"    → no club       ✓ (would otherwise match the Institute row)
//   "National Science Day"        → no club       ✓
// Anything unmatched keeps club_id null and reads as Institute exactly as before.
const attachClub = (entries, clubs) => {
    const named = clubs
        .filter((c) => c.name && c.name.trim().toLowerCase() !== 'institute')
        .map((c) => ({ id: c.id, name: c.name, needle: c.name.toLowerCase().replace(/\s*\(.*\)\s*$/, '').trim() }))
        .filter((c) => c.needle.length >= 4)
        .sort((a, b) => b.needle.length - a.needle.length);   // longest first: "Cinema Club" over "Cinema"
    return entries.map((e) => {
        const hay = ` ${String(e.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
        const hit = named.find((c) => hay.includes(` ${c.needle.replace(/[^a-z0-9]+/g, ' ').trim()} `));
        return hit ? { ...e, clubId: hit.id, clubName: hit.name } : e;
    });
};

// GET / — current semester (or ?semester=) in the exact legacy shape.
router.get('/', async (req, res) => {
    try {
        const rows = await store.getServedEntries({ semester: req.query.semester });
        // Public feed hides not-yet-dated (TBD) rows so the calendar never renders a null date.
        const base = rows.filter((r) => r.start_date).map(store.toPublic);
        // Additive only: entries that match nothing are returned byte-identical to before.
        const clubs = await Club.findAll({ attributes: ['id', 'name'], raw: true }).catch(() => []);
        const data = attachClub(base, clubs);
        // The teaching-day totals the uploaded PDF states about itself. Additive and nullable: the
        // calendar page shows the figure when it is here and hides the tile when it is not, so a
        // layout we cannot parse costs a tile rather than displaying a stale number.
        const coverage = await store.getServedCoverage({ semester: req.query.semester }).catch(() => null);
        res.json({ total: data.length, data, teachingDays: coverage?.teachingDays || null });
    } catch (error) {
        serverError(res, error);
    }
});

// GET /semesters — list available semesters (past/upcoming picker).
router.get('/semesters', async (req, res) => {
    try {
        res.json({ data: await store.listSemesters() });
    } catch (error) {
        serverError(res, error);
    }
});

// ── ADMIN: import history (for the rollback UI) ─────────────────────────────────
router.get('/imports', checkAcademicCalendarPermission, async (req, res) => {
    try {
        res.json({ data: await store.listImports({}) });
    } catch (error) {
        serverError(res, error);
    }
});

// ── ADMIN: current calendar in editable form (for "Edit current calendar") ──────
router.get('/current', checkAcademicCalendarPermission, async (req, res) => {
    try {
        const current = await store.getCurrentEditable(req.query.semester ? { semester: req.query.semester } : {});
        if (!current) return res.status(404).json({ error: 'No calendar', message: 'No academic calendar has been published yet.' });
        res.json(current);
    } catch (error) {
        serverError(res, error);
    }
});

// ── ADMIN: preview (parse only, NO DB write) ────────────────────────────────────
router.post('/import/preview', checkAcademicCalendarPermission, uploadPdf, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file', message: 'Please attach a PDF file.' });

        const report = await parsePdf(req.file.buffer);

        if (report.status === 'ok') {
            return res.json({ ...report, filename: req.file.originalname });
        }
        if (report.status === 'coming_soon') {
            return res.status(200).json({
                status: 'coming_soon',
                reason: report.reason,
                message: STATUS_MESSAGES.coming_soon[report.reason] || STATUS_MESSAGES.coming_soon['other-format'],
            });
        }
        // no_text / unrecognized / uncertain → cannot produce a preview.
        return res.status(422).json({ status: report.status, message: STATUS_MESSAGES[report.status] });
    } catch (error) {
        if (error.code === 'PDF_UNREADABLE') {
            return res.status(422).json({ status: 'unreadable', message: 'The uploaded file could not be read as a PDF.' });
        }
        serverError(res, error);
    }
});

// ── ADMIN: commit the reviewed calendar (atomic upsert) ─────────────────────────
router.post('/import/commit', checkAcademicCalendarPermission, validateBody(commitBody), async (req, res) => {
    try {
        const { institution, program, semester, entries, coverage, filename } = req.body || {};
        if (!Array.isArray(entries) || entries.length === 0) {
            return res.status(400).json({ error: 'No entries', message: 'There are no calendar entries to publish.' });
        }
        const result = await store.commitCalendar({
            institution, program, semester, entries, coverage,
            strategy: 'iitr-deterministic',
            uploadedBy: req.user && req.user.user_id,
            sourceFilename: filename || null,
        });
        return res.json({ status: 'committed', ...result });
    } catch (error) {
        if (error.code === 'MISSING_SEMESTER') return res.status(400).json({ error: 'Missing semester', message: error.message });
        if (error.code === 'EMPTY_ENTRIES') return res.status(400).json({ error: 'No entries', message: error.message });
        serverError(res, error);
    }
});

// ── ADMIN: rollback to a previous import ────────────────────────────────────────
router.post('/import/:id/rollback', checkAcademicCalendarPermission, validateParams(importIdParam), async (req, res) => {
    try {
        const result = await store.rollbackToImport(Number(req.params.id));
        return res.json({ status: 'rolled_back', ...result });
    } catch (error) {
        if (error.code === 'IMPORT_NOT_FOUND') return res.status(404).json({ error: 'Not found', message: error.message });
        serverError(res, error);
    }
});

// GET /:id — single entry (legacy compat). MUST be last so it doesn't shadow
// /import, /imports, /semesters.
router.get('/:id', async (req, res) => {
    try {
        const { AcademicCalendarEntry } = require('../database/schemas');
        const row = await AcademicCalendarEntry.findByPk(req.params.id);
        if (!row) return res.status(404).json({ error: 'Not found', message: 'Academic calendar entry not found' });
        res.json(store.toPublic(row));
    } catch (error) {
        serverError(res, error);
    }
});

module.exports = router;
