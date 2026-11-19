/**
 * ExtractionStrategy — the ONE seam that makes this portable to other calendars.
 *
 * The pipeline (extractText → classify → validate → upsert → serve) is generic.
 * The only institution-specific part is turning already-extracted page text into
 * normalized entries. To support a new college/format later, add a new strategy
 * that implements this contract and a config object — nothing else changes.
 *
 * A strategy is a plain object:
 *
 *   {
 *     name: string,
 *
 *     // Cheap deterministic sniff: is this text the format this strategy handles?
 *     // Returns { match: boolean, confidence: number(0..1), reason?: string }.
 *     canHandle(pages: string[], config): { match, confidence, reason },
 *
 *     // Turn extracted page text into normalized entries. MUST NOT touch the DB.
 *     // Throws with err.code = 'ABORT_UNCERTAIN_KEY' if it cannot determine the
 *     // semester/program with confidence (never guess the upsert key).
 *     extract(pages: string[], config): ExtractionResult,
 *   }
 *
 * ExtractionResult:
 *   {
 *     entries: Entry[],   // { title, category, startDate|null, endDate|null,
 *                         //   description, isHoliday, tentative, rawDateText }
 *     flags:   Flag[],    // { title, reason, rawText } — outliers surfaced, never guessed
 *     meta:    { institution, program, semester, rowCount },
 *   }
 *
 * Dates are 'YYYY-MM-DD' strings or null (null = couldn't parse a definite date;
 * the row is flagged tentative for the admin to fill in the preview).
 */

module.exports = {};
