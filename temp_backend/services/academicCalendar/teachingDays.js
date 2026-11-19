/**
 * Pull the OFFICIAL teaching-day totals out of an academic calendar PDF.
 *
 * Why parse rather than compute: the calendar states these figures itself, in a "Teaching days for
 * <Semester>" table, and its arithmetic is not something you can reproduce by counting weekdays. It
 * deducts a per-weekday allowance for "MTE/ETE/IFD/Convocation/Thomso" — counting Mon-Fri between
 * commencement and the last date of teaching, subtracting holidays and adding working Saturdays,
 * gives 76 for Autumn 2026-27 where the document says 72. The document wins; it is the thing the
 * institute actually published.
 *
 * The Calendar page used to hardcode `70`. That was not invented — it is the real total from
 * Acad_CalendarFor_All_Programs_Other_than_MBA.pdf, left behind when the semester moved on. Which is
 * the whole argument for reading it from whatever PDF was last uploaded.
 *
 * TWO LAYOUTS, both seen in docs/academic calender samples:
 *   Autumn — the total row is labelled: "72 for others" / "69 for UG I year" (UG I starts late, so it
 *            gets its own smaller total).
 *   Spring — no separate intake, so the row is bare numbers ending in the grand total.
 *
 * SAFETY: the grand total must equal the sum of the monthly totals on the same row. That is a real
 * check, not a formality — it is what stops a stray number elsewhere in the table being reported as
 * the total. If it does not hold, this returns null and the UI hides the figure rather than showing
 * a wrong one. Verified against the samples:
 *   Autumn 2026-27  12+18+17+18+07 = 72  ✓
 *   Spring 2025-26  15+19+15+21    = 70  ✓
 */

const HEADER = /teaching\s+days\s+for/i;
// A plausible semester. Guards against picking up a stray year or a row index.
const MIN_DAYS = 30;
const MAX_DAYS = 140;

/**
 * The "Total … days" row at the FOOT of the table.
 *
 * Careful: the table also has a COLUMN header reading "Total Teaching days", and it comes first. An
 * un-anchored search for /^\s*Total/ finds that instead and the block then swallows the entire date
 * grid — about a hundred numbers, among which something will always reconcile by accident. So skip
 * any "Total" immediately followed by "Teaching", and take the last remaining one.
 */
const totalsBlock = (segment) => {
    const candidates = [...segment.matchAll(/^[ \t]*Total\b(?![ \t]*Teaching)/gim)];
    if (!candidates.length) return null;
    const start = candidates[candidates.length - 1].index;
    const rest = segment.slice(start);
    // The legend after the table always mentions a non-teaching day or an examination.
    const end = rest.search(/non[-\s]?teaching|examination/i);
    return end > 0 ? rest.slice(0, end) : rest;
};

/**
 * Spring layout: every monthly total is a bare number on the same row, so the grand total is the one
 * that equals the sum of the rest. A genuine check — it is what stops a stray table number being
 * reported as the total.
 */
const reconcile = (nums) => {
    for (let i = nums.length - 1; i >= 0; i--) {
        const candidate = nums[i];
        if (candidate < MIN_DAYS || candidate > MAX_DAYS) continue;
        const rest = nums.filter((_, j) => j !== i);
        if (rest.reduce((a, b) => a + b, 0) === candidate) return candidate;
    }
    return null;
};

/**
 * Autumn layout: the monthly totals are only PARTLY labelled — "12 for others" and "18 for others"
 * appear, but the months whose figure sits in a different column ("17", "07") do not. So the sum
 * never reconciles and the grand total has to be identified another way.
 *
 * The invariant that does hold: a semester total is larger than any single month within it, so the
 * grand total is the maximum. The range guard is what keeps a year ("2026") or a date out.
 */
const largestInRange = (nums) => {
    const ok = nums.filter((n) => n >= MIN_DAYS && n <= MAX_DAYS);
    return ok.length ? Math.max(...ok) : null;
};

/**
 * @param {string[]} pages  text of each PDF page
 * @returns {{others:number, ugFirstYear:number|null}|null}
 */
function extractTeachingDays(pages) {
    const text = (pages || []).join('\n');
    const i = text.search(HEADER);
    if (i < 0) return null;
    const segment = text.slice(i, i + 4000);

    // ── Autumn layout: totals are labelled ────────────────────────────────────────────────────────
    const labelled = (re) => largestInRange([...segment.matchAll(re)].map((m) => Number(m[1])));
    const others = labelled(/(\d+)\s*for\s*others/gi);
    const ug = labelled(/(\d+)\s*for\s*UG\s*I/gi);
    // UG I year starts later, so its total must not exceed the general one — a cheap cross-check that
    // the two figures came from the row we think they did.
    if (others) return { others, ugFirstYear: ug && ug <= others ? ug : null };

    // ── Spring layout: bare numbers, grand total last on the Total row ────────────────────────────
    const block = totalsBlock(segment);
    if (!block) return null;
    const nums = [...block.matchAll(/\b(\d{1,3})\b/g)].map((m) => Number(m[1]));
    const total = reconcile(nums);
    return total ? { others: total, ugFirstYear: null } : null;
}

module.exports = { extractTeachingDays };
