/**
 * IITR general (non-MBA) academic-calendar extraction strategy.
 * Ports the validated spike: normalize glyph-fragmented text → split rows on the
 * sequential S.No. anchor → parse dates/categories → flag outliers (never guess).
 * Also parses page-2 "List of Holidays" and "Time-Table Rescheduling".
 *
 * Pure functions — no DB, no I/O. Input: extracted page text. Output: normalized
 * entries + flags + meta (see ExtractionStrategy.js contract).
 */

const DAYS = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday';
const DATE_RE = /\b(\d{2})\.(\d{2})\.(\d{4})\b/;
const DATE_RE_G = /\b\d{2}\.\d{2}\.\d{4}\b/g;
const MONTHS = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

// ── text helpers ──────────────────────────────────────────────────────────────

// pdfjs splits dates into loose glyphs, and the spacing varies wildly between
// PDFs ("0 8 .01.2026", "14.0 2.202 5"). Rejoin any fragmented DD.MM.YYYY no
// matter how the glyphs were split, then collapse runs of spaces.
function normalize(raw) {
    let s = raw || '';
    s = s.replace(
        /(\d)\s*(\d)\s*\.\s*(\d)\s*(\d)\s*\.\s*(\d)\s*(\d)\s*(\d)\s*(\d)/g,
        '$1$2.$3$4.$5$6$7$8'
    );
    s = s.replace(/[ \t]{2,}/g, ' ');
    return s;
}

function cleanTitle(t) {
    return (t || '')
        .replace(/\s+/g, ' ')
        .replace(/(\w)\s+-\s+(\w)/g, '$1-$2') // "Re - examination" → "Re-examination"
        // Footnote markers from the PDF. Removing them can jam a word against the bracket it pointed
        // at — "Idu'l Fitr***(subject to moon)" would become "Idu'l Fitr(subject to moon)" — so put the
        // space back. The parenthetical itself is real information and must survive.
        .replace(/[*#]+/g, '')
        .replace(/(\S)\(/g, '$1 (')
        .replace(/\s*[-–—]\s*$/, '')
        .trim();
}

function slug(s) {
    return (s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'entry';
}

// "DD.MM.YYYY" → "YYYY-MM-DD" (validated), else null.
function toISO(ddmmyyyy) {
    const m = (ddmmyyyy || '').match(DATE_RE);
    if (!m) return null;
    const [, dd, mm, yyyy] = m;
    const d = +dd, mo = +mm;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${yyyy}-${mm}-${dd}`;
}

// ── category inference (no category column in the PDF) ──────────────────────────
// Anything not matched by a rule is a plain Academic item (registrations,
// deadlines, etc.) — that's the correct default, not an "unknown".
function inferCategory(title, config) {
    for (const rule of config.categoryRules) {
        if (rule.match.test(title)) return rule.category;
    }
    return 'Academic';
}

// ── page 1: the numbered main table ─────────────────────────────────────────────
function parseMainTable(page1, config) {
    const norm = normalize(page1 || '');
    const tokens = norm.split(/\s+/).filter(Boolean);

    // Split into records anchored on the running S.No. (1,2,3…) that starts a row
    // (an integer immediately followed by a capital letter / "(" = a Details cell).
    const records = [];
    let cur = null, expect = 1;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const next = tokens[i + 1] || '';
        if (t === String(expect) && /^[A-Z(]/.test(next)) {
            if (cur) records.push(cur);
            cur = { sno: expect, text: [] };
            expect++;
            continue;
        }
        if (cur) cur.text.push(t);
    }
    if (cur) records.push(cur);

    const entries = [];
    const flags = [];
    for (const r of records) {
        const joined = r.text.join(' ');
        const dates = joined.match(DATE_RE_G) || [];
        const firstDate = dates[0];
        const title = cleanTitle(firstDate ? joined.slice(0, joined.indexOf(firstDate)) : joined);
        if (!title) continue;

        const hasOR = /\bOR\b/.test(joined);
        const rawDateText = dates.length ? joined.slice(joined.indexOf(firstDate)).replace(/\s+/g, ' ').trim() : joined.trim();
        const twTentative = /\btentative\b/i.test(joined); // explicit "tentative" wording
        const category = inferCategory(title, config);

        // Build one or more date "slots" for the row. Most rows → 1 slot. An event
        // held on two separate ranges (e.g. Orientation on two weekends) → one slot
        // per range, so it becomes multiple clean entries (fits the model, no flag).
        let slots = [];
        let flagReason = null;
        if (dates.length === 0) {
            slots = [{ startDate: null, endDate: null, tentative: true }];
            flagReason = 'No recognizable date (free text) — please set the date.';
        } else if (hasOR) {
            const d = toISO(dates[0]);
            slots = [{ startDate: d, endDate: d, tentative: true }];
            flagReason = 'Alternative dates ("OR") — confirm which applies.';
        } else if (dates.length > 2 && dates.length % 2 === 0) {
            for (let k = 0; k < dates.length; k += 2) {
                slots.push({ startDate: toISO(dates[k]), endDate: toISO(dates[k + 1]), tentative: false });
            }
        } else if (dates.length > 2) {
            slots = [{ startDate: toISO(dates[0]), endDate: toISO(dates[1]), tentative: true }];
            flagReason = 'Multiple/split date ranges — please confirm.';
        } else if (dates.length === 2) {
            slots = [{ startDate: toISO(dates[0]), endDate: toISO(dates[1]), tentative: false }];
        } else {
            const d = toISO(dates[0]);
            slots = [{ startDate: d, endDate: d, tentative: false }];
        }

        for (const slot of slots) {
            entries.push({
                title,
                category,
                startDate: slot.startDate,
                endDate: slot.endDate,
                description: title,
                isHoliday: false,
                tentative: slot.tentative || twTentative,
                rawDateText,
            });
        }
        if (flagReason) flags.push({ title, reason: flagReason, rawText: rawDateText });
    }
    return { entries, flags };
}

// ── page 2: List of Holidays ────────────────────────────────────────────────────
function parseHolidays(page2) {
    if (!page2) return [];
    const norm = normalize(page2);
    const idx = norm.search(/List\s+of\s+Holidays/i);
    if (idx === -1) return [];

    let region = norm.slice(idx + 'List of Holidays'.length);
    region = region.split(/Event\s*[–\-\/]/i)[0]; // stop at the colour legend
    region = region.replace(/\*?\s*Subject to change in the visibility of the moon\.?/ig, ' ');

    const dates = region.match(DATE_RE_G) || [];
    const parts = region.split(DATE_RE_G);
    // Tolerant of glyph-fragmented day names ("Wednes day"): match a day prefix
    // with an optional internal space before "day".
    const stripLeadDay = /^\s*(?:mon|tues|wednes|thurs|fri|satur|sun)\s*day\b/i;

    const entries = [];
    for (let i = 0; i < dates.length; i++) {
        let rawName = parts[i] || '';
        if (i > 0) rawName = rawName.replace(stripLeadDay, ''); // drop prev holiday's day-of-week
        const tentative = /\*/.test(parts[i] || '');
        const name = cleanTitle(rawName);
        const iso = toISO(dates[i]);
        if (!name || !iso) continue;
        entries.push({
            title: name,
            category: 'Holiday',
            startDate: iso,
            endDate: iso,
            description: name,
            isHoliday: true,
            tentative,
            rawDateText: dates[i],
        });
    }
    return entries;
}

// ── page 2: Time-Table Rescheduling / Compensatory classes ──────────────────────
function parseReschedule(page2) {
    if (!page2) return [];
    const norm = normalize(page2);
    const start = norm.search(/Reschedul/i);
    if (start === -1) return [];
    let region = norm.slice(start);
    const hol = region.search(/List\s+of\s+Holidays/i);
    if (hol !== -1) region = region.slice(0, hol);

    const dateRe = /([A-Za-z]+)\s+(\d{1,2})\s*,\s*(\d{4})/g;
    const entries = [];
    let m;
    while ((m = dateRe.exec(region))) {
        const mon = MONTHS[m[1].toLowerCase()];
        if (!mon) continue;
        const iso = `${m[3]}-${mon}-${String(m[2]).padStart(2, '0')}`;
        const after = region.slice(m.index + m[0].length, m.index + m[0].length + 60);
        // Only a reschedule entry if a weekday "…Time Table / Timetable" descriptor
        // follows (allow curly OR straight apostrophes: "Thursday's" / "Wednesdays'").
        const desc = after.match(/(mon|tues|wednes|thurs|fri|satur|sun)day['’]?s?['’]?\s+(?:time\s*-?\s*table|timetable)/i);
        if (!desc) continue;
        const STEMS = { mon: 'Monday', tues: 'Tuesday', wednes: 'Wednesday', thurs: 'Thursday', fri: 'Friday', satur: 'Saturday', sun: 'Sunday' };
        const dayName = STEMS[desc[1].toLowerCase()]; // canonical weekday
        entries.push({
            title: `Time-Table Reschedule (${dayName}'s timetable)`,
            category: 'Timetable Reschedule',
            startDate: iso,
            endDate: iso,
            description: `Classes follow ${dayName}'s timetable`,
            isHoliday: false,
            tentative: false,
            rawDateText: `${m[1]} ${m[2]}, ${m[3]}`,
        });
    }
    return entries;
}

// ── semester / program from the header (drives the upsert key) ───────────────────
// The header's year can be glyph-fragmented too ("202 4-2 5"), so match against a
// whitespace-stripped copy of the header region.
function extractMeta(pages, config) {
    const compact = (pages[0] || '').slice(0, 1500).replace(/\s+/g, '');
    let semester = null;
    const m = compact.match(/(AUTUMN|SPRING)SEMESTER(\d{4}-\d{2})/i);
    if (m) {
        const term = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(); // Autumn|Spring
        semester = `${term} ${m[2]}`;
    }
    return { institution: config.institution, program: config.program, semester };
}

// ── strategy object ─────────────────────────────────────────────────────────────
const iitrDeterministic = {
    name: 'iitr-deterministic',

    canHandle(pages, config) {
        const text = (pages || []).join('\n');
        const isCal = config.calendarMarkers.some((re) => re.test(text));
        const isGeneral = config.generalMarkers.some((re) => re.test(text));
        const isMBA = config.mbaMarkers.some((re) => re.test(text));
        return { match: isCal && isGeneral && !isMBA, confidence: isCal && isGeneral && !isMBA ? 0.95 : 0 };
    },

    extract(pages, config) {
        const page1 = pages[0] || '';
        const page2 = pages[1] || '';

        const main = parseMainTable(page1, config);
        const holidays = parseHolidays(page2);
        const reschedule = parseReschedule(page2);

        // Dedup on (title + startDate) — the page-2 summary block repeats some rows.
        const all = [...main.entries, ...holidays, ...reschedule];
        const seen = new Set();
        const deduped = [];
        for (const e of all) {
            const key = `${e.title.toLowerCase()}|${e.startDate || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(e);
        }

        // Assign stable sort order. The DB id is built at commit time (store.toRow)
        // scoped by semester+program so it's unique across semesters.
        const entries = deduped.map((e, i) => ({ ...e, sortOrder: i + 1 }));

        const meta = extractMeta(pages, config);
        meta.rowCount = entries.length;

        return { entries, flags: main.flags, meta };
    },
};

module.exports = iitrDeterministic;
// exported for unit reuse / seeding
module.exports._internals = { normalize, cleanTitle, toISO, slug, parseMainTable, parseHolidays, parseReschedule, extractMeta };
