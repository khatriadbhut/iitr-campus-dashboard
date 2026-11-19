// Notice display helpers (shared by the Notices list card and the detail view).
// Per the notice-card UX spec: facts in chips, ONE complete sentence of prose
// (truncated in JS at a sentence/word boundary — never mid-word), full text one tap deep.

export const NOTICE_KINDS = [
    { label: 'Scholarship', re: /scholarship|yojna|chhatravrati|fellowship|fee waiver|financial assistance/i, cls: 'k-scholarship' },
    { label: 'Fee', re: /fee payment|\bfees?\b/i, cls: 'k-fee' },
    { label: 'Registration', re: /registration|admission|enrol/i, cls: 'k-reg' },
    { label: 'Resource', re: /terminal|bloomberg|subscription|portal|repository|access now/i, cls: 'k-resource' },
    { label: 'Facility', re: /closure|closed|maintenance|pool|field|hours|timing|slot/i, cls: 'k-facility' },
    { label: 'Recruitment', re: /recruit|hiring|applications open|\bpor\b|core team/i, cls: 'k-recruit' },
];

// Stored kind key (set by the ingestion pipeline / Groq reviewer) → display label + colour class.
const KIND_DISPLAY = {
    scholarship: { label: 'Scholarship', cls: 'k-scholarship' },
    recruitment: { label: 'Recruitment', cls: 'k-recruit' },
    competition: { label: 'Competition', cls: 'k-comp' },
    fee: { label: 'Fee', cls: 'k-fee' },
    registration: { label: 'Registration', cls: 'k-reg' },
    resource: { label: 'Resource', cls: 'k-resource' },
    facility: { label: 'Facility', cls: 'k-facility' },
    deadline: { label: 'Deadline', cls: 'k-deadline' },
    notice: { label: 'Notice', cls: 'k-notice' },
};

export const noticeKind = (n) => {
    // Prefer the server-classified kind; fall back to keyword derivation for legacy rows.
    if (n.kind && KIND_DISPLAY[n.kind]) return KIND_DISPLAY[n.kind];
    const t = `${n.title || ''} ${n.body || ''}`;
    const hit = NOTICE_KINDS.find((k) => k.re.test(t));
    if (hit) return hit;
    if (n.deadline) return { label: 'Deadline', cls: 'k-deadline' };
    return { label: 'Notice', cls: 'k-notice' };
};

// Strip a leading list marker from a line. The stored body carries them for two reasons: the pipeline
// prefixes the action line with "→ " and detail lines with "• ", and forwarded campus mail arrives
// with its own bullets. The UI already renders each point AS a bullet, so leaving them in produced
// "• → Inform the SCSP Office…" — a bullet, an arrow, and then the text.
// Requires trailing whitespace so a genuine "-5 degrees" or an em-dash aside is left alone.
const stripMarker = (s) => String(s).replace(/^\s*(?:[→➔➜▶►•·*‣⁃]|-{1,2}>|=>)\s*/u, '').replace(/^\s*[-–—]\s+/, '').trim();



// Split into sentences and drop a leading low-information greeting sentence
// ("Greetings from …!", "Dear all,", "Hello everyone.") — generic, not per-notice.
// Sentence splitting that survives ABBREVIATIONS and INITIALS. A bare /(?<=[.!?])\s+/ treats every
// period as a terminator, so "the Prof. S.N. Tandon Scholarship" broke into three separate bullets
// ("…for the Prof." / "S.N." / "Tandon Scholarship…") and the card snippet ended at "the Prof.".
// Campus mail is dense with these — B.Tech., Ph.D., Dr., Prof., Rs., a.m./p.m. — plus initials in
// names, so this fired constantly. Mask the periods that belong to an abbreviation, split, restore.
// The trailing [A-Z] alternative is what catches single initials like "S." and "N.".
// This mirrors the same guard in the ingestion service's noticeBody(); the display layer needs its
// own copy because it re-splits the STORED body, which no longer carries that context.
// Named abbreviations. Ph.D FIRST and the multi-word degrees before their prefixes, or "Ph." masks
// alone and leaves a stray "D." to terminate the sentence.
const ABBR = /\b(?:Ph\.?\s?D|B\.?\s?Tech|M\.?\s?Tech|B\.?\s?Arch|M\.?\s?Sc|B\.?\s?Sc|M\.?\s?A|B\.?\s?A|Ph|Dr|Prof|Mr|Mrs|Ms|Shri|Smt|Sr|Jr|St|No|Nos|Rs|Vs|vs|etc|approx|Dept|dept|Univ|univ|a\.m|p\.m|A\.M|P\.M|i\.e|e\.g)\./g;
// A RUN of initials — "S.N." or "S. N.". Deliberately requires two or more.
//
// A bare /[A-Z]\./ alternative looks like the obvious way to catch initials, and it is wrong: it also
// masks a sentence that genuinely ENDS in a single capital, so "…posted the list on Channel‑I." glued
// itself to the sentence after it. Real initials come in runs or follow a title, and both are matched
// below without swallowing a legitimate full stop.
const INITIAL_RUN = /\b(?:[A-Z]\.\s?){2,}/g;
const DOT = '\u0001';
// A lone initial immediately after a title we just masked: "Prof. S. Tandon".
const LONE_INITIAL = new RegExp(`(?<=(?:Prof|Dr|Mr|Mrs|Ms|Shri|Smt)${DOT}\\s)[A-Z]\\.`, 'g');

// Doubled sentence punctuation — ".," / ",." — typed by whoever wrote the original email. Not
// something the pipeline introduces, but it still lands on the card, and the stronger mark is the one
// that was meant.
//
// Abbreviations are masked FIRST, because "B. Tech., M. Tech." has exactly the same shape as the
// artifact — a period, a comma, a space, a capital — and a naive rule deletes a legitimate list comma
// there. Masking makes the abbreviation's period invisible to the tidy, so only real doubles collapse.
// "..." survives as an ellipsis.
const tidyPunct = (s) => String(s)
    .replace(ABBR, (m) => m.replace(/\./g, DOT))
    .replace(INITIAL_RUN, (m) => m.replace(/\./g, DOT))
    .replace(/\.{3,}/g, '…')
    .replace(/([.!?])[,;:]+/g, '$1')
    .replace(/[,;:]+([.!?])/g, '$1')
    .replace(/([,;:])\1+/g, '$1')
    .split(DOT)
    .join('.');

const splitSentences = (s) => {
    const masked = String(s)
        .replace(ABBR, (m) => m.replace(/\./g, DOT))
        .replace(INITIAL_RUN, (m) => m.replace(/\./g, DOT))
        .replace(LONE_INITIAL, (m) => m.replace(/\./g, DOT));
    const arr = masked.split(/(?<=[.!?])\s+/)
        .map((x) => x.split(DOT).join('.').trim())
        .filter((x) => x.length > 1);
    while (arr.length > 1 && arr[0].length < 70
        && /^(greetings|hello|hi|dear\b|warm greetings|good (morning|afternoon|evening)|namaste|respected)/i.test(arr[0])) {
        arr.shift();
    }
    return arr;
};

// One informative, sentence-complete snippet. { text, trimmed }.
export const noticeSnippet = (body) => {
    if (!body) return { text: '', trimmed: false };
    // Same line-break problem as bodyPoints, one level worse: the snippet is a SINGLE line, so a
    // block that ends without punctuation glued itself to the next one — "…by August 23 2026 The SCSP
    // Office has posted…". Terminate each block before joining so the sentence splitter can see them.
    const full = String(body)
        .split(/\r?\n/)
        .map((l) => tidyPunct(stripMarker(l)).replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map((l) => (/[.!?:;]$/.test(l) ? l : `${l}.`))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    const s = full
        // drop raw URLs (and a dangling "at/via/here" preposition before them),
        // but keep the sentence-ending punctuation that follows the URL
        .replace(/\s*(?:\b(?:at|via|here|below|link)\b\s*:?\s*)?https?:\/\/[^\s]+?(?=[.,;:!?]?(?:\s|$))/gi, '')
        // strip a zero-information opener clause up to its first comma (NOT the whole sentence)
        .replace(/^(on behalf of|this is to inform|dear (all|students)|greetings)[^,.]*,\s*/i, '')
        .replace(/\s+([.,;:])/g, '$1')       // tidy spaces left before punctuation
        .replace(/\s+/g, ' ')
        .trim();
    const sentences = splitSentences(s);
    let out = '';
    for (const sent of sentences) {
        const next = out ? `${out} ${sent}` : sent;
        if (next.length <= 150) out = next; else break;
    }
    if (!out) {                              // first sentence itself > 150 → cut at a word boundary
        const cut = s.slice(0, 140);
        out = cut.slice(0, cut.lastIndexOf(' ')).trim() + '…';
    }
    out = out.charAt(0).toUpperCase() + out.slice(1);   // opener strip can leave lowercase start
    return { text: out, trimmed: out.replace(/…$/, '').trim() !== s };
};

// One line per POINT — the same split the card's bullets use, exposed for the admin editor so that
// what an admin edits maps one-to-one onto what a student reads. Deliberately does NOT strip URLs the
// way bodyPoints does: bodyPoints removes the CTA link because the card shows it as a button, but an
// EDITOR must never silently drop content from the text it is about to save back.
export const noticeBodyLines = (text) => splitSentences(String(text || '').replace(/\s+/g, ' ').trim())
    .map((x) => tidyPunct(stripMarker(x)))
    .filter(Boolean);

const BODY_URL = /https?:\/\/[^\s<>()\[\]]+/g;
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'link'; } };
const escapeRe = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Break a notice body into clean, scannable points — one per sentence — keeping any URL as a
// CLICKABLE segment instead of deleting it. Deleting stranded the punctuation around it: "out now on
// YouTube (https://youtu.be/x), Instagram" rendered as "out now on YouTube (, Instagram".
// Returns Array<Array<{text} | {url,label}>>.
//
// `skipUrl` is the link already shown as the CTA button. That one IS removed — offering it twice is
// noise — but it takes its brackets and its introducing word with it, so "Register at <url> before
// the deadline" reads "Register before the deadline" rather than "Register at before the deadline".
export const bodyPoints = (body, skipUrl) => {
    if (!body) return [];
    // Break on the body's own newlines FIRST. Collapsing all whitespace up front destroyed the
    // paragraph breaks the pipeline wrote, so an action line with no full stop ran straight into the
    // next paragraph: "Inform the SCSP Office by email by August 23 2026 The SCSP Office has posted…"
    // — one bullet, two unrelated sentences, no punctuation between them.
    const blocks = String(body).split(/\r?\n/).map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const clean = blocks.join('\n');
    const ctaRe = skipUrl
        ? new RegExp(`\\s*(?:\\b(?:at|via|here|on|below|link|using)\\b\\s*:?\\s*)?[([]?\\s*${escapeRe(String(skipUrl).replace(/\/+$/, ''))}\\/?\\s*[)\\]]?`, 'i')
        : null;

    return blocks.flatMap((b) => splitSentences(b)).map((sentence) => {
        let s = tidyPunct(stripMarker(sentence));
        if (ctaRe) {
            // replace with a SPACE, not nothing: the pattern eats the whitespace on both sides, so
            // "Register at <url> before" would otherwise close up into "Registerbefore".
            s = s.replace(ctaRe, ' ')
                .replace(/\s{2,}/g, ' ')
                .replace(/\s+([.,;:])/g, '$1')
                // the colon that introduced the removed link is left stranded against the full stop:
                // "through the MyGov survey:." — drop it, and collapse any doubled punctuation.
                .replace(/[:;,]\s*(?=[.!?])/g, '')
                .replace(/([.,;:])\1+/g, '$1')
                .replace(/\(\s*\)|\[\s*\]/g, '')
                .trim();
        }
        const segs = [];
        let last = 0, m;
        BODY_URL.lastIndex = 0;
        while ((m = BODY_URL.exec(s))) {
            const before = s.slice(last, m.index);
            if (before) segs.push({ text: before });
            segs.push({ url: m[0], label: hostOf(m[0]) });
            last = m.index + m[0].length;
        }
        const tail = s.slice(last);
        if (tail) segs.push({ text: tail });
        return segs.length ? segs : [{ text: s }];
    }).filter((segs) => {
        // Keep anything carrying a link, plus anything with real prose.
        if (segs.some((x) => x.url)) return true;
        const text = segs.map((x) => String(x.text || '')).join('').trim();
        if (text.length <= 1) return false;
        // Drop a STRANDED LABEL. Removing the CTA link takes the sentence with it and leaves the word
        // that introduced it — the live "Provisional List of Convocation Awards" notice ended with a
        // bullet reading just "Notice:". A short run of words ending in a colon, with no sentence
        // after it, is a label for something no longer there.
        if (/^[A-Za-z][A-Za-z\s'’-]{0,24}:$/.test(text)) return false;
        return true;
    });
};

export const fmtDate = (iso, opts) => {
    if (!iso) return '';
    try {
        const d = new Date(/T/.test(iso) ? iso : `${iso}T00:00:00`);
        return d.toLocaleDateString('en-IN', opts || { day: 'numeric', month: 'short', year: 'numeric' });
    } catch { return ''; }
};

// Deadline chip: date when far out, countdown when near, tint escalates. { label, cls } | null
export const deadlineChip = (iso) => {
    if (!iso) return null;
    const d = new Date(`${iso}T00:00:00`);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((d - today) / 864e5);
    const short = fmtDate(iso, { day: 'numeric', month: 'short' });
    if (days < 0) return { label: 'Closed', cls: 'dl-past' };
    if (days === 0) return { label: 'Today', cls: 'dl-red' };
    if (days === 1) return { label: 'Tomorrow', cls: 'dl-red' };
    if (days <= 2) return { label: `${days} days left`, cls: 'dl-red' };
    if (days <= 7) return { label: `${days} days left`, cls: 'dl-amber' };
    return { label: short, cls: 'dl-grey' };
};

export const daysLeftText = (iso) => {
    if (!iso) return '';
    const d = new Date(`${iso}T00:00:00`);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.round((d - today) / 864e5);
    if (days < 0) return 'closed';
    if (days === 0) return 'today';
    if (days === 1) return '1 day left';
    return `${days} days left`;
};

// "Opportunities" = opt-in items you apply/enter for (recruitment/PoR, scholarship,
// competition, deadline); "Info" = things to know / obligations (fee, registration, facility).
export const OPPORTUNITY_KINDS = ['Scholarship', 'Recruitment', 'Competition', 'Deadline'];
export const isOpportunity = (n) => {
    // Prefer the server flag; fall back to kind-label derivation for legacy rows.
    if (typeof n.is_opportunity === 'boolean') return n.is_opportunity;
    return OPPORTUNITY_KINDS.includes(noticeKind(n).label);
};

// Run by someone other than IIT Roorkee. The pipeline decides this (see isExternalNotice in the
// ingestion service) and stores it; there is deliberately NO keyword fallback here, because the
// signals that matter — the link's domain, "organised by", "at IIT Roorkee" — live in the raw email,
// not in the trimmed card text. Guessing from the title alone produced exactly the errors the flag
// exists to prevent ("MemTechAI International Workshop" is hosted at IITR).
export const isExternalNotice = (n) => n?.is_external === true;

export const linkHost = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'link'; } };
export const linkLabel = (url) => {
    const h = linkHost(url);
    if (/forms\.gle|docs\.google/.test(h)) return 'Open application form';
    if (/channeli\.in/.test(h)) return 'View on Channel-i';
    return 'Open link';
};

// ── When a notice leaves the feed ────────────────────────────────────────────────────────────────
// Notices never expired: the default view applied no date test at all, so every published notice
// stayed forever and a passed deadline only turned its chip grey ("Closed"). Measured 2026-08-27:
// 48 live notices with nothing to remove them, and an arrival rate of ~2.3/day — roughly 120 by the
// end of one month, 320 by the end of a semester.
//
// Three branches, in precedence order:
//
//   1. A STATED DATE ALWAYS WINS. A deadline (or an event date) is better information than the
//      notice's age, so it governs outright — no age cap on top of it. This matters: Course Drop was
//      mailed on 5 Aug for a 5 Oct deadline, and any age rule applied to it would have hidden the
//      notice a month before the date it exists to announce. It stays visible through the end of the
//      deadline day, exactly like an event, so "closes today" still reads as open.
//
//   2. AN UNDATED OPPORTUNITY gets 10 days. Nothing in these emails says when they close — measured
//      over the whole batch, 8 of 9 contained no duration language whatsoever — so any window is a
//      guess and a longer one is not a better-informed one. Ten days spans two weekends, which is
//      the behavioural bet: someone who has not acted by then will not act on a third.
//
//   3. EVERYTHING ELSE undated gets 7 days. Campus policy and service notices — the AC guidance, the
//      SAC access route, a faculty welcome — stay true indefinitely, but a feed answers "what is new
//      and what must I do", not "what is permanently the case". Nobody wants the dog-feeding-points
//      notice in their scroll every day for a semester.
//
// The clock runs from published_at, NOT the source email: a student's window should start when the
// notice first became visible to them. Ageing from an email they never saw would hide half of any
// backfilled batch the moment it went live.
//
// Nothing is deleted — this is a display filter. The admin Notices tab still lists everything.
const DAY_MS = 86400000;
export const UNDATED_OPPORTUNITY_DAYS = 10;
export const UNDATED_OTHER_DAYS = 7;

export const isNoticeOnFeed = (n, now = Date.now()) => {
    if (!n) return false;
    const startOfToday = (() => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); })();
    // 1 — a stated date governs, and nothing else applies on top of it
    const dated = n.deadline || n.event_date;
    if (dated) {
        const end = new Date(`${String(dated).slice(0, 10)}T23:59:59`).getTime();
        return Number.isFinite(end) ? end >= startOfToday : true;   // unparseable → keep, never hide silently
    }
    // 2/3 — undated: age out from when it became visible
    const since = n.published_at || n.created_at;
    if (!since) return true;                                        // no clock → keep
    const age = new Date(since).getTime();
    if (!Number.isFinite(age)) return true;
    const days = isOpportunity(n) ? UNDATED_OPPORTUNITY_DAYS : UNDATED_OTHER_DAYS;
    return now - age < days * DAY_MS;
};
