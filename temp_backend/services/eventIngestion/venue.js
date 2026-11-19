/**
 * Venue normaliser. One place, one spelling.
 *
 * The pipeline already picks the RIGHT venue out of an email (measured: 24/25 through the real Groq
 * path). What it cannot do is agree with itself — the same room arrives as "APJ-AKB 205", "APJ–205",
 * "APJAKB-205" and "APJ-AKB, Room 405" depending on who typed the mail. This turns all of those into
 * one string, so a venue can be grouped, searched and recognised.
 *
 * Every rule here was derived from a measured year of student-notices mail — 1025 emails, 213 of which
 * stated a venue, 145 distinct strings. The scorer that produced those numbers, and re-runs against
 * the corpus, lives at __tests__/venueNormalize.js. Do not change a rule without re-running it.
 *
 * Format:  <Place>[-<room>][ (sub-location)]     e.g.  APJ-205 · APJ-004/005 · MAC Auditorium
 *                                                      SAC OAT (1st Floor) · Conference Room, Civil Dept
 * Returns null when the string names no usable place on the Roorkee campus — an off-campus venue, the
 * whole-institute non-answer ("IIT Roorkee"), or a promise ("will be shared shortly"). A blank venue
 * reads as "check the description"; a wrong or useless one reads as an answer and is worse.
 */

// A venue line in a flattened Gmail body runs straight into the next field. Everything from here on
// belongs to some other field, not the venue.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{23E9}-\u{23FA}\u{2190}-\u{21FF}]/u;
const NEXT_FIELD = /\s*(?:new\s+)?(?:time|date|dates|when|eligibility|platform|contact|register|registration|fee|prize|deadline|entry|note|venue)\s*[:\-–]/i;
// …and sometimes it just runs into prose.
const PROSE = /\s+(?:which|we look forward|please arrive|all (?:members|are welcome)|everyone is|refreshments|👉|on \d{1,2}(?:st|nd|rd|th)?\s)/i;
// a bare clock time trailing the venue, with no "Time:" label to mark it
const TRAILING_TIME = /\s*[|\-–]?\s*\d{1,2}[:.]\d{2}\s*(?:am|pm)?\s*(?:onwards)?\s*$/i;
// …and one leading it: "3:00 PM in the Committee Room"
const LEADING_TIME = /^\s*\d{1,2}[:.]?\d{0,2}\s*(?:am|pm)?\s*(?:onwards\s*)?(?:in|at)\s+(?:the\s+)?/i;

// One place, many spellings. Longest alternative first — "APJ Abdul Kalam Building" must beat "APJ".
const ALIASES = [
    [/\bapj[\s\-–]*abdul[\s\-–]*kalam[\s\-–]*(?:building|bhawan)?\b(?:\s*\(apjakb\)?)?/i, 'APJ'],
    [/\bapj[\s\-–]*akb\b|\bapjakb\b|\bapj\b(?!\s*abdul)/i, 'APJ'],
    [/\blal\s+bahadur\s+shastri\b/i, 'LBS'],
    [/\bnew\s+technology\s+block\b|\btechnology\s+block\b|\bntb\b/i, 'NTB'],
    [/\bgargi\s+block\b|\bgb\b/i, 'Gargi Block'],
    [/\bmac\s*(?:auditorium|audi(?:torium)?)\b/i, 'MAC Auditorium'],
    [/\bsac\b/i, 'SAC'],
    [/\blhc\b/i, 'LHC'],
    [/\bmgcl\b|\bmahatma\s+gandhi\s+central\s+library\b/i, 'MGCL'],
];

// Departmental initialisms nobody outside the department reads. The rule the venue has to satisfy is
// "a first-year can find this place", so these become plain English.
const COMMON_NAMES = [
    [/\bpradeep\s+kapse\s+auditorium\b\s*,?\s*(?:mied)?(?:\s*\(mechanical\))?/i, 'Mechanical Dept Auditorium'],
    [/\bauditorium\s+hred\b|\bhred\s+auditorium\b/i, 'Hydro Dept Auditorium'],
    [/\bchemical(?:\s+engineering)?\s+auditorium\b/i, 'Chemical Dept Auditorium'],
    [/\bbsbe\b/i, 'Biosciences Dept'],
    [/\bcsed\b/i, 'Computer Science Dept'],
    [/\bece\s+dept\.?\b|\bece\b/i, 'Electronics Dept'],
    [/\bdepartment\s+of\s+wrd&?m\b|\bwrd&m\b|\bwrdm\b/i, 'Water Resources Dept'],
    [/\bdepartment\s+of\s+management\s+studies\b/i, 'DoMS'],
    [/\bdepartment\s+of\s+design\b\s*(?:\(dod\))?|\bdod\b/i, 'Department of Design'],
    // OAT stays OAT — but there are several (SAC, MAC, Swimming Pool), so it only counts as a venue
    // when something says WHICH one. A bare "OAT" names no place.
    [/\boat\b/i, 'OAT'],
    [/\bdap\b|\bdepartment\s+of\s+architecture(?:\s+(?:and|&)\s+planning)?\b/i, 'Architecture Dept'],
    [/\b(?:department\s+of\s+civil(?:\s+eng(?:g|ineering)?)?|civil\s+eng(?:g|ineering)?\.?\s+department)\b/i, 'Civil Dept'],
    [/\b(?:department\s+of\s+chemistry|chemistry\s+department)\b/i, 'Chemistry Dept'],
    [/\b(?:department\s+of\s+physics|physics\s+department)\b/i, 'Physics Dept'],
    [/\bcentre\s+for\s+nanotechnology\b/i, 'Nanotechnology Centre'],
    [/\bmahatma\s+gandhi\s+central\s+library\b/i, 'MGCL'],
    [/\bo\.?\s?p\.?\s+jain\s+auditorium\b/i, 'OP Jain Auditorium'],
    [/\blbs\b(?!\s*ground)[^,]*/i, 'LBS Ground'],
];

const ROOM = /\b(APJ|LHC|Gargi Block|GB|NTB)\s*,?\s*[-–]?\s*(?:room\s*(?:no\.?)?\s*)?[-–]?\s*(\d{3,4}(?:\s*[,&/]\s*(?:\d{3,4}|APJ\s*-?\s*\d{3,4}))*)/i;
const SUB = /\((\s*(?:g(?:round)?|1st|2nd|3rd|first|second|third|ground)\s*floor[^)]*|[^)]*floor[^)]*)\)/i;
// Not on the Roorkee campus. Online is checked BEFORE this — a webinar run from Delhi is still
// attendable from a hostel room, so it stays; a venue you'd have to travel to does not.
const OFF_CAMPUS = /\bbengaluru|bangalore|new delhi|\bdelhi\b|mumbai|kanpur|raipur|chhattisgarh|hyderabad|chennai|kharagpur|guwahati|\bnit\b|\biisc\b|\biim\b|\bnift\b|parliament|rashtrapati|head\s*quarters|c\.?\s?b\.?\s?r\.?\s?i\b|civil hospital|junior high school|\bsaharanpur\b|\bntb\b|new technology block|\bpolymer\b/i;
// A string with no place token in it at all is not a venue — it is a stray label or a promise.
const HAS_PLACE = /\b(apj|apjakb|lhc|gb|gargi|sac|ntb|mac|lbs|abn|mgcl|auditorium|audi|hall|room|ground|stadium|court|pool|gym|block|bhawan|mandir|department|dept|centre|center|lawn|foyer|oat|library|kiosk|campus|online|building|theatre|counter|stalls|school|college|institute|hospital|area|point|club|arena|cafe|canteen|mess|guest house)\b/i;

// About 1% of emails put two places in one venue field — a workshop that runs Saturday at one venue and
// Sunday at another, or an inauguration in a foyer with the sessions in a room. Rare enough that a second
// venue column is not worth it, common enough that dropping the second half silently is wrong. So: split,
// normalise each half, and join. The date that labels each half is kept, since without it the pair is useless.
const DAY_SPLIT = /\s*(?:📍|\|)\s*(?=\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i;
const DAY_PREFIX = /^\s*(\d{1,2}(?:st|nd|rd|th)?\s+[a-z]+)\s*[:\-–]\s*/i;

function normalizeVenue(input) {
    if (!input) return null;
    const raw = String(input).replace(/\s+/g, ' ').trim();
    if (DAY_SPLIT.test(raw)) {
        const parts = raw.split(DAY_SPLIT).map((seg) => {
            const d = DAY_PREFIX.exec(seg);
            const place = normalizeOne(seg.replace(DAY_PREFIX, ''));
            return place && (d ? `${place} (${d[1]})` : place);
        }).filter(Boolean);
        if (parts.length > 1) return parts.join(' / ');
        if (parts.length === 1) return parts[0];
    }
    // a stray "Venue:" further inside the string is the real answer; whatever preceded it was a stray label
    const inner = /(?:^|\s)(?:🏫\s*)?venue\s*[:\-–]\s*(.+)$/i.exec(raw);
    return normalizeOne(inner ? inner[1] : raw);
}

function normalizeOne(input) {
    if (!input) return null;
    let s = String(input).replace(/\s+/g, ' ').trim();

    // 1. cut the bleed-through from the following field
    const em = s.search(EMOJI); if (em > 2) s = s.slice(0, em);
    const nf = s.search(NEXT_FIELD); if (nf > 2) s = s.slice(0, nf);
    const pr = s.search(PROSE); if (pr > 2) s = s.slice(0, pr);
    s = s.replace(/^\s*(?:venue|location|place|where|starting\s+point)\s*[:\-–]\s*/i, '').trim();
    s = s.replace(LEADING_TIME, '').replace(TRAILING_TIME, '').trim();
    s = s.replace(/^[\s,;.\-–]+/, '').trim();
    s = s.replace(/[\s,;.|\-–(]+$/, '').trim();

    if (!HAS_PLACE.test(s)) return null;
    if (/^\(?\s*oat\b/i.test(s)) return null;               // unqualified "OAT" — which one?                      // "Collection Details:", "shared shortly"
    if (/^(?:online|virtual)\b/i.test(s)) return 'Online';

    // 2. anything off the Roorkee campus is not shown
    if (OFF_CAMPUS.test(s)) return null;
    // Roorkee is the default campus and the suffix adds nothing
    s = s.replace(/,?\s*\(?\b(?:iit\s*roorkee|iitr?\b\.?|roorkee\s*campus|saharanpur\s*campus|india)\)?/gi, '').trim();
    s = s.replace(/[\s,;.\-–]+$/, '').trim();

    // 3. one spelling per place
    for (const [re, canon] of ALIASES) s = s.replace(re, canon);
    s = s.replace(/\b(APJ|LHC|NTB|SAC)\s+block\b/gi, '$1');
    s = s.replace(/\bGargi Block\s*\(\s*g\s*argi\s+block\s*\)/i, 'Gargi Block');
    for (const [re, canon] of COMMON_NAMES) s = s.replace(re, canon);
    s = s.replace(/\bDept\s+Dept\b/gi, 'Dept').replace(/,\s*,/g, ',');

    // 4. block + room -> BLOCK-ROOM, multi-room joined with /
    const m = ROOM.exec(s);
    if (m) {
        const rooms = m[2].split(/[,&/]/).map((r) => r.replace(/\D/g, '')).filter(Boolean);
        const rest = (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length))
            .replace(TRAILING_TIME, '').replace(/\s+/g, ' ').replace(/^[\s,;.\-–]+|[\s,;.\-–]+$/g, '');
        const sub = SUB.exec(rest);
        s = `${m[1] === 'GB' ? 'Gargi Block' : m[1]}-${rooms.join('/')}`;
        if (sub) s += ` (${sub[1].trim()})`;
        else if (rest && !/^\(|\)$/.test(rest) && rest.length < 40) s = `${s}, ${rest}`;
    }

    s = s.replace(/\bMAC\b(?!\s*(?:Auditorium|OAT))/g, 'MAC Auditorium');
    // an opening paren left dangling by a field cut is noise, not a sub-location
    if ((s.match(/\(/g) || []).length > (s.match(/\)/g) || []).length) s = s.slice(0, s.lastIndexOf('(')).trim();
    s = s.replace(/\s+/g, ' ').replace(/^[\s,;.\-–]+|[\s,;.\-–]+$/g, '');
    return s || null;
}

module.exports = { normalizeVenue };
