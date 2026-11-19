/**
 * Fill in a notice's deadline from the academic calendar it points at.
 *
 * Some campus mail states no date and defers to the calendar instead:
 *
 *   "Please refer to the Academic Calendar (Autumn Semester 2026-27) for last date for withdrawal of
 *    courses available on the link given below"
 *
 * The app already parses those calendar PDFs, so it holds the answer the email is pointing at — in a
 * different table, unlinked. The student sees a notice with no deadline while the database knows the
 * date is 5 October 2026.
 *
 * The gate is deliberately narrow, because the failure mode is asymmetric: a MISSING deadline is a
 * small loss, while a WRONG one puts a confident countdown on the card and sorts it into "closing this
 * week". All four must hold:
 *
 *   1. the notice has no deadline of its own
 *   2. its text explicitly refers to the academic calendar
 *   3. its text names a semester the calendar actually has
 *   4. exactly one entry in that semester wins on COVERAGE, decisively
 *
 * Coverage, not word count, is what makes (4) work. Scoring the live example by raw overlap gives a
 * three-way tie at 2 matched words; scoring by the share of each ENTRY's own words that matched picks
 * the right one outright:
 *
 *   Last date for withdrawal of courses        2/2 = 1.00   ← correct
 *   Re-examination and Second examination…     2/5 = 0.40
 *   Academic registration of all existing…     2/9 = 0.22
 *
 * Measured 2026-08-26: of 15 dateless notices, exactly ONE refers to the calendar. This is a narrow
 * pattern, not a general repair, and it is written to stay narrow.
 */
const STOP = new Set(['the', 'of', 'on', 'for', 'and', 'to', 'in', 'a', 'by', 'is', 'are', 'be', 'will',
    'from', 'at', 'as', 'an', 'last', 'date', 'dates', 'all', 'with', 'you', 'your', 'may', 'not', 'it',
    'this', 'that', 'their', 'has', 'have', 'its', 'per', 'via', 'any', 'can']);

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const sig = (s) => [...new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)))];

// Must name the calendar explicitly. A passing mention of a semester is not a deferral to it.
const REFERS_TO_CALENDAR = /academic[\s_]calendar/i;

// The winner must cover essentially all of its own words, and beat the runner-up clearly. Both
// thresholds exist to refuse rather than guess: a semester holds ~52 entries, so there is ample room
// for a plausible-looking wrong answer.
const MIN_COVERAGE = 0.8;
const MIN_MARGIN = 0.3;

/**
 * @param {{title?:string, body?:string, deadline?:string|null}} notice
 * @param {Array<{semester:string, title:string, start_date:string}>} entries  all calendar entries
 * @returns {{date:string, entry:string, semester:string, coverage:number} | null}
 */
function deadlineFromCalendar(notice, entries) {
    if (!notice || notice.deadline) return null;
    const text = `${notice.title || ''} ${notice.body || ''}`;
    if (!REFERS_TO_CALENDAR.test(text)) return null;

    // "Autumn Semester 2026-27" and "Autumn 2026-27" are both used, sometimes in the same thread — the
    // raw mail writes the first, the generated summary tends to the second. Missing the word "Semester"
    // meant the real Course Drop email matched nothing while its own summary matched fine.
    const m = /(autumn|spring)\s*(?:semester\s*)?(\d{4})[-\s]?(\d{2})/i.exec(text);
    if (!m) return null;
    const wanted = norm(`${m[1]} ${m[2]}-${m[3]}`);
    const semester = [...new Set((entries || []).map((e) => e.semester))].find((s) => norm(s).includes(wanted));
    if (!semester) return null;

    const words = new Set(sig(text));
    const scored = (entries || [])
        .filter((e) => e.semester === semester && e.start_date)
        .map((e) => {
            const own = sig(e.title);
            const hit = own.filter((w) => words.has(w)).length;
            return { title: e.title, date: e.start_date, coverage: own.length ? hit / own.length : 0, hit };
        })
        .filter((e) => e.hit > 0)
        .sort((a, b) => b.coverage - a.coverage);

    const top = scored[0];
    if (!top || top.coverage < MIN_COVERAGE) return null;
    const second = scored[1];
    if (second && top.coverage - second.coverage < MIN_MARGIN) return null;

    return { date: top.date, entry: top.title, semester, coverage: Number(top.coverage.toFixed(2)) };
}

module.exports = { deadlineFromCalendar };
