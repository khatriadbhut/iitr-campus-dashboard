/**
 * Recover a deadline the email states in plain words, when the classifier returned none.
 *
 * Why this exists: the LLM extracts deadlines well but not deterministically. Measured 2026-08-27, the
 * GCI Program notice was published with no deadline at all even though its mail says "Deadline:
 * September 10th" — and re-running the same email through the same code extracted it correctly. So the
 * extractor is not broken; it is variable, and a missing deadline is the costliest failure this system
 * has. It looks identical to a genuinely open-ended notice, so nothing downstream can tell that a date
 * was lost, and the student never sees a countdown for something that closes.
 *
 * This is a BACKSTOP, not a second extractor. Three properties make it safe to run on every notice:
 *
 *   1. FILL-ONLY. It is consulted only when no deadline was found. It can never overwrite or contradict
 *      the classifier, which is why it cannot drag accuracy down — the worst case is that it stays
 *      silent, which is also its most common case.
 *
 *   2. CUE-ANCHORED. The date must directly follow an explicit deadline phrase. A bare date somewhere
 *      in the body is not enough: the Cyclothon mail mentions "September 5" (the ride) while announcing
 *      a fitness test on 22 August, and grabbing loose dates is exactly how that went wrong once.
 *
 *   3. REFUSES ON AMBIGUITY. Two or more distinct cue-dates and it returns nothing. The UPLB exchange
 *      mail says "Deadline September 10, 2026" AND "Referee Deadline September 12, 2026"; the pipeline
 *      once took the later one and told students they had two extra days. Refusing is the only honest
 *      answer when the text carries two candidates and nothing marks which is authoritative.
 *
 * Measured over all 77 notice proposals: silent on 67, refused 1 (the UPLB trap), fired on 9 — of which
 * 8 agreed with the classifier and 1 filled the real miss. Zero disagreements.
 *
 * Deliberately English-only and phrase-bound. Anything it does not recognise ("apply before Friday",
 * "closes EOD", the Hindi fee-waiver mail) simply falls through, which is the correct failure.
 */
const MONTHS = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
    august: 8, september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

// "Deadline:", "Last date to apply", "Apply by", "Registration closes" — a phrase that can only mean a
// closing date. Deliberately NOT "before"/"till"/"due", which appear constantly in ordinary prose
// ("due diligence before an investment is made" is a real sentence from one of these emails).
const CUE = /(deadline|last date(?:\s+(?:to|for)\s+\w+(?:\s+\w+)?)?|apply by|applications? close|register by|registration (?:deadline|closes))\s*(?:is|:|-|–|—)?\s*/gi;

// "10 September", "September 10", either with an optional year and ordinal suffix.
const DATE = /^\s*(?:on\s+)?(?:(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)|([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?)\s*,?\s*(\d{4})?/;

const isoOf = (day, monthWord, year, fallbackYear) => {
    const mm = MONTHS[String(monthWord || '').toLowerCase()];
    if (!mm || !day || day < 1 || day > 31) return null;
    return `${year || fallbackYear}-${String(mm).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/**
 * @param {string} text        the email body (subject may be prepended by the caller)
 * @param {Date|number} [now]  reference point, for the year when the mail omits one
 * @returns {{date: string, cue: string} | null}
 */
function statedDeadline(text, now = Date.now()) {
    const blob = String(text || '').replace(/\s+/g, ' ');
    if (!blob) return null;
    const fallbackYear = new Date(now).getFullYear();
    const found = [];
    let m;
    CUE.lastIndex = 0;
    while ((m = CUE.exec(blob))) {
        const after = blob.slice(m.index + m[0].length, m.index + m[0].length + 40);
        const d = DATE.exec(after);
        if (!d) continue;
        const iso = d[1] ? isoOf(+d[1], d[2], d[5], fallbackYear) : isoOf(+d[4], d[3], d[5], fallbackYear);
        if (iso) found.push({ date: iso, cue: m[1].toLowerCase().trim() });
    }
    if (!found.length) return null;
    const distinct = [...new Set(found.map((f) => f.date))];
    if (distinct.length > 1) return null;         // two candidates → refuse, do not pick
    return { date: distinct[0], cue: found[0].cue };
}

module.exports = { statedDeadline };
