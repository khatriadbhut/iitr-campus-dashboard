/**
 * Academic-calendar pipeline orchestrator (parse side).
 *
 * parsePdf(buffer) runs stages 1-8 with NO DB writes and returns a report the
 * admin preview renders. The commit/upsert (stages 9-10) lives in the route layer
 * so this module stays a pure, testable parser.
 */

const { extractText } = require('./extractText');
const { extractTeachingDays } = require('./teachingDays');
const { classifyDocument, REGISTRY } = require('./registry');
const llmAssist = require('./llmAssist');

// Shift a 'YYYY-MM-DD' by N days (UTC, no tz drift).
function shiftDays(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
}
const alnum = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const validISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/**
 * SANDBOXED Groq assist for flagged outlier rows. Attaches an `aiSuggestion` to a
 * flagged entry — it NEVER overwrites a parsed date. Suggestions are validated
 * (valid ISO + within the calendar's own date window ±60d) and discarded otherwise.
 */
async function applyAiSuggestions(entries, flags, meta) {
    const cleanDates = entries.filter((e) => e.startDate && !e.tentative).map((e) => e.startDate).sort();
    if (cleanDates.length === 0) return; // no window to validate against → don't guess
    const min = shiftDays(cleanDates[0], -60);
    const max = shiftDays(cleanDates[cleanDates.length - 1], 60);

    const suggestions = await llmAssist.suggestOutlierDates(
        flags.map((f) => ({ title: f.title, rawText: f.rawText })),
        meta.semester
    );
    if (!suggestions) return;

    for (const sug of suggestions) {
        if (!sug || !validISO(sug.startDate)) continue;
        const end = validISO(sug.endDate) ? sug.endDate : sug.startDate;
        if (sug.startDate < min || sug.startDate > max || end < min || end > max) continue; // guardrail
        const entry = entries.find((e) => alnum(e.title) === alnum(sug.title) && (e.tentative || !e.startDate));
        if (entry) entry.aiSuggestion = { startDate: sug.startDate, endDate: end };
    }
}

function runSanity(entries, meta, config) {
    const warnings = [];
    const n = entries.length;
    if (n < config.sanity.minRows || n > config.sanity.maxRows) {
        warnings.push(`Unusual number of events (${n}). A typical calendar has ${config.sanity.minRows}–${config.sanity.maxRows}.`);
    }
    for (const anchor of config.sanity.requiredAnchors) {
        if (!entries.some((e) => anchor.pattern.test(e.title))) {
            warnings.push(`Couldn't find the expected entry "${anchor.label}" — the layout may have changed.`);
        }
    }
    if (!meta.semester) {
        warnings.push('Could not read the semester from the header — please set it manually before publishing.');
    }
    return warnings;
}

function buildCoverage(entries, flags, meta) {
    return {
        semester: meta.semester,
        program: meta.program,
        institution: meta.institution,
        total: entries.length,
        tentative: entries.filter((e) => e.tentative).length,
        flagged: flags.length,
        holidays: entries.filter((e) => e.isHoliday).length,
    };
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<Report>} where Report.status is one of:
 *   'ok'           → { entries, flags, warnings, coverage, meta }
 *   'coming_soon'  → { reason }         (recognized MBA/other calendar)
 *   'unrecognized' → {}                 (not a calendar)
 *   'no_text'      → {}                 (scan / no text layer)
 *   'uncertain'    → {}                 (deterministic unsure; LLM tie-break TODO, fail safe)
 */
async function parsePdf(buffer) {
    // Stage 2-3: extract text layer.
    const extracted = await extractText(buffer);
    if (!extracted.hasTextLayer) {
        return { status: 'no_text' };
    }

    // Stage 4: three-way classification (deterministic-first).
    let cls = classifyDocument(extracted.pages);

    // Groq tie-breaker — ONLY when deterministic is unsure. Fails safe (stays
    // uncertain) if Groq is unavailable or non-committal.
    if (cls.kind === 'uncertain' && llmAssist.isEnabled()) {
        const verdict = await llmAssist.classifyDocument(extracted.pages);
        if (verdict === 'general') cls = { kind: 'general', config: REGISTRY[0].config, strategy: REGISTRY[0].strategy };
        else if (verdict === 'mba_or_other') cls = { kind: 'coming_soon', reason: 'other-format' };
        else if (verdict === 'not_calendar') cls = { kind: 'not_calendar' };
    }

    if (cls.kind === 'coming_soon') return { status: 'coming_soon', reason: cls.reason };
    if (cls.kind === 'not_calendar') return { status: 'unrecognized' };
    if (cls.kind === 'uncertain') return { status: 'uncertain' };

    // Stage 5-6: extract entries with the matched strategy.
    const { config, strategy } = cls;
    const { entries, flags, meta } = strategy.extract(extracted.pages, config);

    // Stage 6.5: sandboxed Groq suggestions for flagged rows (suggestion-only).
    if (flags.length && llmAssist.isEnabled()) {
        try { await applyAiSuggestions(entries, flags, meta); }
        catch (e) { console.warn('[groq] outlier suggestions skipped:', e.message); }
    }

    // Stage 7-8: sanity (soft warnings) + coverage.
    const warnings = runSanity(entries, meta, config);
    const coverage = buildCoverage(entries, flags, meta);
    coverage.aiSuggested = entries.filter((e) => e.aiSuggestion).length;
    // The calendar STATES its own teaching-day totals; they are not derivable by counting weekdays
    // (the document deducts a per-weekday MTE/ETE/IFD/Convocation/Thomso allowance). Null when the
    // layout does not yield them, so the UI hides the figure rather than showing a stale one.
    coverage.teachingDays = extractTeachingDays(extracted.pages);

    return { status: 'ok', entries, flags, warnings, coverage, meta };
}

module.exports = { parsePdf };
