/**
 * Event-ingestion pipeline (deterministic, pure, snapshot-tested).
 * rawEmail → gates → dethread → attribute → classify → extract → EventProposal[].
 * No DB / no Gmail here — callers pass a senderMap; store.js persists the output.
 *
 * (Kept cohesive for v1; the doc's finer gates/dethread/attribute/classify/extract
 *  split is a later refactor.)
 */
const { deadlineFromCalendar } = require('./calendarDeadline');
const { statedDeadline } = require('./statedDeadline');
const CFG = require('./institutions/iitr.config');
const { normalizeVenue } = require('./venue');

// Hand-bumped semver for the classification/extraction logic. Stamped into every proposal's evidence
// (evidence.rule_version) for provenance — lets /drift compare precision across rule changes. Bump
// ONLY when classify/kind/extract logic changes; a hash would churn on unrelated edits and defeat that.
const RULE_VERSION = '1.2.0';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const addr = (s) => {
    const m = /<([^>]+)>/.exec(s || '');
    return (m ? m[1] : (s || '')).trim().toLowerCase();
};
// "Head Management Studies <head@ms...>" -> "Head Management Studies"
const senderName = (from) => {
    const m = /^\s*"?([^"<]+?)"?\s*</.exec(from || '');
    return (m ? m[1] : (from || '').split('@')[0]).trim();
};
// collapse whitespace + truncate to a short summary for a notice card.
const summarize = (text, n = 300) => {
    const s = (text || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '…' : s;
};
const stripSubject = (subject) => {
    let s = subject || '';
    let changed = true;
    while (changed) {                    // strip stacked prefixes: "Re: [SPAM] Fwd: X"
        changed = false;
        for (const re of CFG.stripSubjectPrefixes) {
            const n = s.replace(re, '');
            if (n !== s) { s = n; changed = true; }
        }
    }
    return s.trim();
};

// dkim=pass AND spf=pass, both aligned to the institute domain. Parsed from Gmail's
// Authentication-Results rather than recomputed — Gmail already did the DNS work at delivery time.
function senderAuthenticated(authResults, domain) {
    const s = String(authResults || '').toLowerCase();
    if (!s) return false;
    const d = String(domain || '').toLowerCase().replace(/\./g, '\\.');
    // DMARC is exactly the "is the From header honest" question, and Gmail already answered it. It passes
    // on EITHER aligned SPF or aligned DKIM — requiring both is stricter than the standard and rejects
    // real mail: head@iks.iitr.ac.in is dkim=pass + spf=none (that subdomain publishes no SPF record)
    // and is perfectly genuine, carried by dmarc=pass.
    if (new RegExp(`dmarc=pass[^;]*header\\.from=(?:[a-z0-9-]+\\.)*${d}`).test(s)) return true;
    if (/dmarc=(fail|bestguesspass)/.test(s)) return false;
    // No DMARC verdict reported — fall back to either mechanism, aligned to the institute domain.
    const dkimOk = new RegExp(`dkim=pass[^;]*header\\.i=@(?:[a-z0-9-]+\\.)*${d}`).test(s);
    const spfOk = new RegExp(`spf=pass[^;]*(?:[a-z0-9-]+\\.)*${d}`).test(s);
    return dkimOk || spfOk;
}

// ── Gates ────────────────────────────────────────────────────────────────────
// Layered, privacy-first:
//   HARD (never overridable): on-domain  +  addressed to a PUBLIC broadcast list  +  no personal data.
//     The broadcast-list check is the privacy wall — anything sent to the user individually
//     (grades, a professor's mail, OTPs) is not on a list, so it dies here and is never stored.
//   SOFT (overridable by a positive student signal): muted governance senders / junk subjects —
//     a muted office still gets through when it actually sends a holiday/fee/scholarship/exam notice.
function passesGates(email) {
    const from = addr(email.from);
    if (!from.endsWith('@' + CFG.domain) && !from.endsWith('.' + CFG.domain)) return { ok: false, reason: 'gate0_offdomain' };
    const to = (email.to || '').toLowerCase();
    const onList = CFG.broadcastLists.some((l) => to.includes(l));
    if (!onList) return { ok: false, reason: 'gate1_not_broadcast' };      // ← personal mail dies here

    // SENDER AUTHENTICITY (hard, non-overridable). Everything below trusts the From header, and the
    // institute publishes DMARC `p=quarantine; sp=none` — so anyone can send as x@anything.iitr.ac.in
    // and it is neither quarantined nor rejected. senderVerified() is a NAME heuristic, not proof, so a
    // spoof as placement@… would even skip the "unverified sender" badge the human reviewer relies on.
    // Gmail already evaluated SPF/DKIM at delivery; we just honour its verdict.
    // Only enforced when a verdict is present, so a fixture or a replayed message can't wedge ingestion.
    if (email.auth_results && !senderAuthenticated(email.auth_results, CFG.domain)) {
        return { ok: false, reason: 'gate_spoofed_sender' };
    }

    const subj = stripSubject(email.subject);
    const blob = `${subj}\n${email.body_text || ''}`;
    if (CFG.sensitiveContent.test(blob)) return { ok: false, reason: 'gate_sensitive' };  // HARD, non-overridable (PII)
    // HARD governance/commercial deny — about specific people / promos; non-overridable like the PII wall.
    if ((CFG.denySubjectsHard || []).some((re) => re.test(subj))) return { ok: false, reason: 'gate_governance' };

    // Soft denies apply only when there's no genuine student signal to rescue the mail.
    if (!CFG.positiveSignals.test(blob)) {
        if (CFG.denySenders.includes(from)) return { ok: false, reason: 'gate2_deny_sender' };
        if (CFG.denySubjects.some((re) => re.test(subj))) return { ok: false, reason: 'gate2_deny_subject' };
    }
    return { ok: true };
}

// ── De-thread ────────────────────────────────────────────────────────────────
// Keep the top message; but for a Fwd whose top is thin, keep the forwarded block.
// How much content must sit ABOVE a quote before we treat the top as the real message. Tuned on the
// 435-mail corpus: at 200 (the original) this cut 58 mails, and campus forwards routinely carry a thin
// covering note ("Dear all, please see below" + a signature) over the actual announcement — one dropped
// from 2998 to 273 chars, taking its date with it. 900 truncates only 15 and peaks date/time recall.
// Quoted HEADER noise is handled separately by stripQuotedHeaders(), so this does not need to be greedy.
const TOP_MIN = 900;
function topMessage(body) {
    if (!body) return '';
    const cut = body.search(/^\s*[-]{2,}\s*Forwarded message|^\s*From:\s.+@|^\s*On .+wrote:/im);
    if (cut > TOP_MIN) return body.slice(0, cut).trim();   // enough content above the quote
    return body.trim();                                 // thin top → keep whole (forwarded content)
}

// ── Dates ────────────────────────────────────────────────────────────────────
function parseDates(text, sentAt) {
    if (!text) return {};
    const found = [];
    // DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
    for (const m of text.matchAll(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\b/g)) {
        found.push(iso(+m[3], +m[2], +m[1]));
    }
    // "12 Aug 2026" / "12th August 2026"
    for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s*,?\s*(\d{4})\b/g)) {
        const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
        if (mo) found.push(iso(+m[3], mo, +m[1]));
    }
    // "August 12, 2026" / "Aug 12 2026"
    for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})\b/g)) {
        const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
        if (mo) found.push(iso(+m[3], mo, +m[2]));
    }
    // date RANGES: "12-14 August 2026" / "12 to 14 Aug 2026" / "12 & 13 August 2026" → both endpoints
    for (const m of text.matchAll(/\b(\d{1,2})\s*(?:-|–|—|to|&|and)\s*(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s*,?\s*(\d{4})\b/gi)) {
        const mo = MONTHS[m[3].slice(0, 3).toLowerCase()];
        if (mo && +m[1] <= 31 && +m[2] <= 31) { found.push(iso(+m[4], mo, +m[1])); found.push(iso(+m[4], mo, +m[2])); }
    }
    let uniq = [...new Set(found)].sort();
    if (!uniq.length) return {};
    // startDate is the EARLIEST date found, which is wrong the moment an email mentions a date that
    // isn't the event: "Shaheed Diwas … 23 March 1931" yielded a 1931 event date for a 2026 painting
    // competition. When we know when the mail was sent, drop anything that can't plausibly be the
    // event — announcements run from about a month behind (a "Re:" on an older thread) to a year
    // ahead. The LLM merge path already applied this window; the deterministic path never did.
    if (sentAt) {
        const t = new Date(sentAt).getTime();
        if (!isNaN(t)) {
            const plausible = uniq.filter((d) => {
                const days = (Date.parse(`${d}T00:00:00Z`) - t) / 864e5;
                return days >= -35 && days <= 400;
            });
            // If NOTHING is plausible, return no date at all rather than a date we know is wrong —
            // a blank field costs the admin ten seconds, a wrong one puts students in the wrong room
            // on the wrong day. yearlessDate/relativeDate get a shot afterwards, then it stays blank.
            uniq = plausible;
        }
    }
    if (!uniq.length) return {};
    return { startDate: uniq[0], endDate: uniq[uniq.length - 1] !== uniq[0] ? uniq[uniq.length - 1] : null };
}

// Resolve "tonight / today / tomorrow" against the date the mail was SENT.
//
// Club and fest mail routinely says "Silent DJ Night — Tonight at 10:15 PM" and never states the
// date, because to a reader on the day it is obvious. parseDates finds nothing and the event lands
// in review with a blank date.
//
// Measured on 435 real students-notices mails: only 13 contain such a word with no absolute date,
// and most are NOT event dates — "Join us today using the link" (a CTA), "the Constitution we
// celebrate today" (a greeting), "Today I have assumed charge" (an announcement). Resolving all of
// them would be wrong more often than right, and a wrong date is worse than a blank one because
// people turn up on the wrong day.
//
// What separates the true hits is a TIME sitting next to the word. Gating on that (and rejecting a
// preceding call-to-action verb) accepted 3 of the 13 with no false positives: the NCC Republic Day
// parade, Thomso's Silent DJ Night, and a SPARC workshop inauguration. Deliberately conservative —
// it stays silent rather than guess, and whatever it does resolve is still flagged tentative.
// A day+month with NO year — "Schedule: Saturday, 18th July | 9:00 PM", "Date: 26 March".
// parseDates deliberately demands a 4-digit year, so all of these were being dropped: 12 of the 30
// date-less event proposals in a 435-mail sample carry one. The year is the only missing piece, so
// infer it from the send date and pick the reading that lands nearest the announcement — campus mail
// announces ahead, so a date more than ~45 days behind the email almost certainly means next year.
// Forwarded headers ("Sent: Wednesday, July 15, 2026") carry a year, so the negative lookahead
// already excludes them — no need to strip header lines, which would also eat the "Date: 26 March"
// label campus mail uses for the real event date. Inferred dates are flagged tentative.
const YEARLESS = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b(?!\s*,?\s*\d{4})/ig;

function yearlessDate(text, sentAt) {
    if (!text || !sentAt) return null;
    const sent = new Date(sentAt);
    if (isNaN(sent)) return null;
    const body = String(text);
    YEARLESS.lastIndex = 0;
    let m;
    while ((m = YEARLESS.exec(body))) {
        const day = +m[1];
        const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
        if (!mo || day < 1 || day > 31) continue;
        const y = sent.getUTCFullYear();
        let best = null;
        for (const yr of [y - 1, y, y + 1]) {
            const cand = Date.UTC(yr, mo - 1, day);
            const days = (cand - sent.getTime()) / 864e5;
            if (days < -45 || days > 320) continue;          // announced far too long ago / too far ahead
            if (best === null || Math.abs(days) < Math.abs(best.days)) best = { yr, days };
        }
        if (best) return iso(best.yr, mo, day);
    }
    return null;
}

const REL_DAY = /\b(today|tonight|tomorrow|day after tomorrow)\b/ig;
// a clock time within the same window — "10:15 PM", "08:45 hrs", "11:30", "4 pm", "12 noon"
const REL_TIME = /\b\d{1,2}[:.]\d{2}\s*(?:a\.?m\.?|p\.?m\.?|hrs?)?|\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?|hrs)\b|\bnoon\b|\bmidnight\b/i;
// "join/register/apply … today" is an instruction to the reader, never the event's date
const REL_CTA = /\b(join|register|apply|sign\s?up|enrol|enroll|subscribe|book|donate|vote|fill|order|claim)\b[^.]{0,40}$/i;

function relativeDate(text, sentAt) {
    if (!text || !sentAt) return null;
    const sent = new Date(sentAt);
    if (isNaN(sent)) return null;
    REL_DAY.lastIndex = 0;
    let m;
    while ((m = REL_DAY.exec(text))) {
        const word = m[1].toLowerCase();
        const window = text.slice(Math.max(0, m.index - 90), m.index + 90);
        const before = text.slice(Math.max(0, m.index - 40), m.index);
        if (!REL_TIME.test(window)) continue;   // no clock time nearby → not an event date
        if (REL_CTA.test(before)) continue;     // "register today" → an instruction, not a date
        // Campus mail is written in IST; shift into IST before taking the calendar day so an evening
        // mail (after 18:30 UTC) does not resolve to the previous day.
        const ist = new Date(sent.getTime() + 5.5 * 3600 * 1000);
        const add = word === 'tomorrow' ? 1 : word === 'day after tomorrow' ? 2 : 0;
        ist.setUTCDate(ist.getUTCDate() + add);
        return iso(ist.getUTCFullYear(), ist.getUTCMonth() + 1, ist.getUTCDate());
    }
    return null;
}

// Strip QUOTED MAIL HEADERS before pulling dates/times out of a body.
//
// topMessage keeps the forwarded block when the covering note is thin, which is usually right — the
// detail lives in the forward. But the block carries the ORIGINAL message's headers, and those were
// being read as event data:
//   "Sent: Friday, July 24, 2026 6:35:27 PM"  → event date 2026-07-24 (real event was 4 Aug)
//                                             → and time "35:27 PM", the SECONDS
// A standalone "Date: 26 March" is a legitimate event label, so we can't just delete every Date:
// line. Real headers arrive as a BLOCK — two or more consecutive header lines — which is the
// discriminator used here. A lone label survives; From/Sent/To/Subject runs do not.
// Same "thin top" problem as TOP_MIN: a reply whose top is just "Thanks / Sent from my iPhone" carries
// its real content BELOW the marker, and truncating there threw away a genuine "Time and Date: 6:00 PM
// on 22.04.2026". Only truncate when real content sits above; otherwise delete just the marker text, so
// the timestamp inside it ("On Oct 31, 2024 9:48 AM, ... wrote:") still can't be mistaken for an event time.
const REPLY_MIN = 900;
const HDR_LINE = /^\s*(?:from|sent|to|cc|bcc|reply-to|subject|date)\s*:\s?.*$/i;
// Everything after a reply attribution is the quoted original, and its dates are not this event's.
// "On Fri, 18 Oct, 2024, 09:41 National Service Scheme <nss@…> wrote:" gave a Blood Donation Camp a
// start date of 18 Oct when the mail plainly said 20 Oct — the quoted date was simply earlier, and
// earliest wins. Cut the history off before any field is read from it.
// The attribution often WRAPS across lines, so this must span newlines — [^\n] silently missed it.
const REPLY_MARKER = /\bOn\s[\s\S]{0,250}?\bwrote\s*:/i;

function stripQuotedHeaders(text) {
    if (!text) return text;
    const cut = REPLY_MARKER.exec(String(text));
    if (cut && cut.index > REPLY_MIN) text = String(text).slice(0, cut.index);
    else if (cut) text = String(text).replace(REPLY_MARKER, ' ');
    const lines = String(text).split(/\r?\n/);
    const drop = new Array(lines.length).fill(false);
    let run = [];
    const flush = () => { if (run.length >= 2) for (const i of run) drop[i] = true; run = []; };
    for (let i = 0; i < lines.length; i++) {
        if (HDR_LINE.test(lines[i])) run.push(i);
        else if (!lines[i].trim()) { /* blank line keeps a block contiguous */ }
        else flush();
    }
    flush();
    return lines.filter((_, i) => !drop[i]).join('\n');
}

function firstMatch(text, re) { const m = re.exec(text || ''); return m ? m[0].trim() : null; }
const cleanUrl = (u) => (u ? u.replace(/[.,;:)\]]+$/, '') : u);   // drop trailing sentence punctuation
function firstLink(text) {
    const m = /(https?:\/\/[^\s>|)\]]+)/i.exec(text || '');
    return m ? cleanUrl(m[1]) : null;
}
// A sign-off's links are the sender's own profile pages, never the event's. signatureStart() alone does
// not catch them — one stray non-signature-ish line ("Founder @Bhoomicam Pvt. Ltd. startup") breaks the
// all-siggy suffix and the whole block survives, which is how a Civil Engineering talk published the
// coordinator's faculty page as its link. Gmail renders links as "[ url | anchor ]", so the ANCHOR is
// the reliable tell: Webpage / Google Scholar / LinkedIn are never what a student should click.
const PROFILE_ANCHOR = /^(web\s?page|website|homepage|google scholar[^|\]]*|linked ?in|instagram|facebook|twitter|youtube|profile|faculty|departmental website|database upgradation)$/i;
function contentLink(text) {
    for (const raw of String(text || '').split('\n')) {
        const l = raw.trim();
        if (!l || SIG_LINE.test(l) || SIGNOFF.test(l)) continue;
        let m; const md = /\[\s*(https?:\/\/[^\s|\]]+)\s*\|\s*([^\]]+?)\s*\]/g;
        while ((m = md.exec(l))) if (!PROFILE_ANCHOR.test(m[2].trim())) return cleanUrl(m[1]);
        const bare = /(https?:\/\/[^\s>|)\]]+)/i.exec(l.replace(/\[\s*https?:\/\/[^\s|\]]+\s*\|[^\]]*\]/g, ' '));
        if (bare) return cleanUrl(bare[1]);
    }
    return null;
}
function regLink(text) {
    const m = /(https?:\/\/(?:forms\.gle|docs\.google\.com\/forms|unstop\.com|channeli\.in)[^\s>|)\]]+)/i.exec(text || '');
    return m ? cleanUrl(m[1]) : null;
}
// Registration deadline = the date in the sentence right AFTER a deadline cue ("register by …"),
// but ONLY when a DISTINCT later event date exists — otherwise the single date IS the event, not a
// deadline. Sentence-bounded (not a char window) so a later unrelated date can't leak in.
function registrationDeadline(text) {
    if (!text) return null;
    const m = CFG.deadlineCues.exec(text);
    if (!m) return null;
    const rest = text.slice(m.index);
    const cut = rest.search(/[.!?]\s/);
    const window = cut > 0 ? rest.slice(0, cut + 1) : rest.slice(0, 120);
    const inWindow = parseDates(window).startDate;
    if (!inWindow) return null;
    const all = parseDates(text);
    return (all.endDate && all.endDate !== inWindow) ? inWindow : null;   // distinct later event date required
}

// The clock time a DEADLINE closes — "apply by 21 August, 6:00 PM", "last date: 25 Aug till 5 pm".
// Scoped to the sentence containing the deadline cue, so an unrelated time elsewhere in the mail (the
// event's own start time, an office hours line) can never be read as the closing time. Returns the raw
// matched string; normTime() turns it into "HH:MM". No time stated → null, which means end of day.
// The 4-digit 24h form ("1700 hrs") is listed FIRST: alternation is ordered, and the 1-2 digit
// branch would otherwise match just "17" and drop the minutes. normTime already decodes HHMM.
const DEADLINE_TIME = /\b\d{4}\s*(?:hrs?|hours?)\b|\b\d{1,2}[:.]\d{2}\s*(?:a\.?m\.?|p\.?m\.?|hrs?)|\b\d{1,2}\s*(?:a\.?m\.?|p\.?m\.?|hrs)\b|\bnoon\b|\bmidnight\b/i;
// EVERY cue occurrence is checked, not just the first: the subject line is prepended to the body and
// routinely contains the cue with no time ("Last date extended for NSS Recruitment"), which would
// otherwise consume the match and hide the "6:00 PM" stated one line below in the body.
// A SUPERSET of CFG.deadlineCues, used ONLY to locate the closing time. Kept separate on purpose:
// CFG.deadlineCues also feeds `hasDeadline` in classify(), so widening it there would move mail
// between the event/notice buckets — an unacceptable side effect for a time-parsing improvement.
// These extra phrasings are real corpus wording ("submit entries before 25 Aug, 6:30 pm",
// "latest by 27th August, 1700 hrs") that the classification cues deliberately don't cover.
const DEADLINE_CUES_G = new RegExp(
    `${CFG.deadlineCues.source}|latest by|before\\s+\\d{1,2}|till\\s+\\d{1,2}`, 'gi');
function deadlineTimeOf(text) {
    if (!text) return null;
    DEADLINE_CUES_G.lastIndex = 0;
    let m;
    while ((m = DEADLINE_CUES_G.exec(text))) {
        const rest = text.slice(m.index);
        const cut = rest.search(/[.!?]\s|\n/);          // stop at the sentence / line end
        const window = cut > 0 ? rest.slice(0, cut + 1) : rest.slice(0, 140);
        const t = window.match(DEADLINE_TIME);
        if (!t) continue;
        // Same sanity guard extract() applies: an hour above 23 (or above 12 with a meridiem) means we
        // matched the middle of a longer timestamp ("6:35:27 PM" → "35:27 PM"), not a real time.
        const h = parseInt(String(t[0]).match(/\d{1,2}/)?.[0] ?? '', 10);
        const mer = /a\.?m|p\.?m/i.test(t[0]);
        if (!Number.isFinite(h) || h > 23 || (mer && h > 12)) continue;
        return t[0];
    }
    return null;
}

// Speaker — campus mail is talk-heavy and names the speaker 54 times in a 435-mail sample, yet none
// of it was being captured. Two shapes cover almost all of it: an explicit "Speaker: …" label, and
// the "<Talk|Lecture|delivered> by Prof./Dr./Shri X" phrasing used in invitations. Stops at a comma
// or "on"/"about" so the affiliation and the talk title don't get dragged in.
const SPEAKER_LABEL = /\bspeaker\s*\**\s*[:\-]\s*\**\s*([^\n|*]{3,70})/i;
const SPEAKER_BY = /\b(?:talk|lecture|seminar|session|webinar|address|colloquium)\s+(?:will\s+be\s+)?(?:delivered\s+)?by\s+((?:Prof|Dr|Mr|Ms|Mrs|Shri|Smt)\.?\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3})/i;
function speakerOf(text) {
    const lab = (text.match(SPEAKER_LABEL) || [])[1];
    const raw = lab || (text.match(SPEAKER_BY) || [])[1];
    if (!raw) return null;
    const v = raw.replace(/\s+/g, ' ')
        .replace(/\s*[,(].*$/, '')                 // drop ", Secretary, TDB" / "(IIT Delhi)"
        .replace(/\s+\b(?:on|about|titled|regarding)\b.*$/i, '')   // drop " on Smart Engineering…"
        .replace(/[\s.:;-]+$/, '').trim();
    return v.length >= 3 && v.length <= 60 ? v : null;
}

// Join link for online/hybrid sessions. Distinct from registration_link — 28 of 435 mails carry a
// Meet/Zoom/Webex/Teams URL and it was going nowhere, so an attendee had to reopen the email.
const MEET_LINK = /(https?:\/\/(?:[\w.-]*\.)?(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com)[^\s>|)\]"']*)/i;

// Deadline cues beyond the existing sentence-scoped one: an explicit label, or "last date to apply".
// Only used as a fallback so the stricter existing logic keeps priority.
const DEADLINE_LABEL = /\b(?:application|registration|submission)\s*deadline\s*\**\s*[:\-]\s*\**\s*([^\n|*]{3,48})|\blast date (?:for|of|to)[^.\n]{0,30}?\s(?:is|:)\s*([^\n.|]{3,40})/i;

// Eligibility — "Eligibility: …" / "Open to …" / "Who can apply: …". Free text, shown to the admin
// as-is rather than coerced into the small audience enum.
const ELIGIBILITY = /\b(?:eligibilit(?:y|ies)|who can (?:apply|participate))\s*\**\s*[:\-]\s*\**\s*([^\n|*]{4,90})|\bopen (?:to|for)\s+((?:all\s+)?[a-z][^.\n|]{3,60})/i;

// ── Attribute (sender → club/fest) ───────────────────────────────────────────
// Relay mail (gensec.technical / gensec.cult) is sent ON BEHALF OF a club, so the club has to come
// out of the subject. The old rule took the LAST pipe segment, which is usually not the club at all:
//   "PAG | ICPC 2026 Prelims Registration"                 → "ICPC 2026 Prelims Registration"
//   "JASHN | Choreography & Dance Section | Today at 8 PM" → "Today at 8 PM"
//   "Stories from Class of 2026 | OnRec | IIT Roorkee"     → "IIT Roorkee"
// Those became club rows. Matching segments against the known roster instead is lower recall but far
// higher precision, and a wrong club is worse than the honest "Institute" fallback.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim();

// Clubs do not spell their own name twice the same way: DISCOVR signs "Student Technical Council"
// while the roster says "STC (Students’ Technical Council)". Compare on a squashed form — no spaces,
// no punctuation, no trailing IITR — so "InfoSecIITR" also equals "InfoSec".
const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/iitr?$/, '');
const aliasesOf = (clubIndex) => (Array.isArray(clubIndex) ? clubIndex : (clubIndex && clubIndex.aliases) || []);
const denied = (alias) => CFG.clubAliasDenyText.includes(alias);
const isUmbrella = (alias) => CFG.clubUmbrella.includes(alias);

// A club named as a whole "|"-delimited segment, or (unless denied) anywhere in the text. `strict`
// forbids umbrella bodies, which are named inside other clubs' mail as the parent, not the organiser.
function clubInText(text, clubIndex, { strict = true } = {}) {
    const list = aliasesOf(clubIndex);
    if (!list.length || !text) return null;
    const n = norm(text);
    for (const seg of n.split(/[|–—:]/).map((x) => x.replace(/^[\s*-]+|[\s*-]+$/g, ''))) {
        if (!seg) continue;
        for (const [alias, name] of list) if (seg === alias) return name;   // exact segment: umbrella ok
    }
    // Three-letter clubs are real and common here — STC, HEC, MDG, NCC, DSG, PAG. In a SUBJECT they are
    // a deliberate claim, so allow them; in body prose they collide too easily, so keep the 4-char floor
    // there. SAC/CEC/IMG are denied outright: they are a building, a venue, and an image tag.
    const floor = strict ? 4 : 3;
    for (const [alias, name] of list) {
        if (alias.length < floor || denied(alias) || (strict && isUmbrella(alias))) continue;
        if (new RegExp('\\b' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(n)) return name;
    }
    // squashed pass, for names written glued: "InfoSecIITR", "CognizanceIITR"
    const bySquash = (clubIndex && clubIndex.bySquash) || null;
    if (bySquash) {
        for (const tok of n.split(' ')) {
            if (tok.length < 7 || denied(tok)) continue;
            const sq = squash(tok);
            if (sq === tok || denied(sq)) continue;      // nothing was glued
            const hit = bySquash.get(sq);
            if (hit && !(strict && isUmbrella(norm(hit)))) return hit;
        }
    }
    return null;
}

// Phrases that mark a club as the ORGANISER rather than a passing mention. Derived from how the mail
// actually reads: "BlocSoc IITR is here to…", "join us for the ArIES Workshop Series", "organised by X",
// "X presents", "X invites you", "Team X".
// `IITR?` / `IIT Roorkee` routinely sits between the club name and its verb — "SPIC MACAY IIT Roorkee
// is delighted to invite" — so it has to be optional rather than fatal.
const SUFFIX = '(?:\\s+iit\\s*roorkee|\\s+iitr)?';
const ORGANISER_CUE = [
    (a) => new RegExp(`\\b${a}\\b${SUFFIX}\\s+(?:is|are|was|were|presents?|invites?|brings?|welcomes?|organis|organiz|hosts?|will)`),
    (a) => new RegExp(`\\bgreetings\\s+from\\s+(?:the\\s+)?\\b${a}\\b`),
    (a) => new RegExp(`(?:organised|organized|hosted|presented|conducted|brought to you)\\s+by\\s+(?:the\\s+)?\\b${a}\\b`),
    (a) => new RegExp(`\\b(?:team|from the desk of|on behalf of)\\s+\\b${a}\\b`),
    (a) => new RegExp(`\\b${a}\\b\\s+(?:workshop series|recruitment|session|club|society)`),
    (a) => new RegExp(`\\bjoin\\s+(?:us\\s+)?(?:for\\s+)?(?:the\\s+)?\\b${a}\\b`),
];

function clubOrganiserInBody(bodyText, clubIndex) {
    const list = aliasesOf(clubIndex);
    if (!list.length || !bodyText) return null;
    const n = norm(bodyText);
    for (const [alias, name] of list) {
        if (alias.length < 4 || denied(alias) || isUmbrella(alias)) continue;
        const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (ORGANISER_CUE.some((mk) => mk(esc).test(n))) return name;
    }
    return null;
}

function clubFromSubject(subject, clubIndex) {
    return clubInText(stripSubject(subject), clubIndex, { strict: false });   // the subject IS the claim
}

// RELAY MAIL CARRIES TWO SIGN-OFFS: the club's, then a "---" line, then the forwarding gensec's — and
// that second block is always the same council (its `stc.iitr` link appears in 101 emails a year).
// Read only the block ABOVE the delimiter; everything below belongs to the forwarder, never the organiser.
function clubFromSignOff(bodyText, clubIndex) {
    if (!bodyText) return null;
    const cut = bodyText.search(/\n\s*-{2,}\s*\n/);
    const own = (cut > 0 ? bodyText.slice(0, cut) : bodyText).slice(-400);
    const bySquash = (clubIndex && clubIndex.bySquash) || null;
    for (const raw of own.split(/\n/).map((x) => x.trim()).filter(Boolean).reverse()) {
        const line = raw.replace(/^(regards|thanks(?:\s*&\s*regards)?|warm regards|best|sincerely)[,\s]*/i, '')
            .replace(/^team\s+/i, '').replace(/[|,.]+$/, '').trim();
        if (!line || line.length > 44) continue;
        const sq = squash(line);
        if (!sq || denied(norm(line))) continue;
        const hit = bySquash && bySquash.get(sq);
        if (hit) return hit;
    }
    return null;
}

// Evidence for who ORGANISED this, strongest first. The old rule only consulted the roster when the
// sender was one of two relay addresses, so 180 of every 208 emails had the club name sitting in the
// subject, the roster containing that club, and the two never compared — 95% fell to "Institute".
// Every address in a To/Cc header, normalised the same way addr() normalises a From. A header holds
// a comma-separated list, and display names may themselves contain commas inside quotes — so split on
// commas that sit outside quotes rather than on every comma.
function addrList(header) {
    if (!header) return [];
    return String(header)
        .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
        .map((part) => addr(part))
        .filter(Boolean);
}

function attribute(email, senderMap, clubIndex) {
    const from = addr(email.from);
    const isRelay = CFG.relaySenders.includes(from);

    // 1 · the club's OWN address, from the roster. Exact, no guessing — 24% of a year's mail on its own.
    //     Relays are excluded: gensec.cult@ is stored as Cultural Council but forwards for everyone.
    const byEmail = (clubIndex && clubIndex.byEmail) || null;
    if (!isRelay && byEmail) {
        const owner = byEmail.get(from) || (CFG.clubExtraAddresses || {})[from];
        if (owner) return { club: owner, via: 'club_email' };
    }
    // 2 · admin-taught sender map still wins over any text — but NOT for a relay. The map stores the
    //     FORWARDER (gensec.cult@ → Cultural Council), not the organiser, so letting it win here
    //     shadows the subject and collapses every cultural club into the council: measured over a
    //     year, 18 of the 39 relay mails it claimed had the real club named right there in the
    //     subject (CineSec, Kshitij, Dramatics Section, Fine Arts, Fashion Society, SPIC MACAY).
    //     For a relay the map is a FALLBACK, applied below once the text has had its say.
    if (!isRelay && senderMap && senderMap[from]) return { club: senderMap[from], via: 'sender' };
    // 3 · the subject names a club.
    const bySubject = clubFromSubject(email.subject, clubIndex);
    if (bySubject) return { club: bySubject, via: 'subject' };
    // 4 · the club signs off above the forwarder's block.
    const bySignOff = clubFromSignOff(email.body_text, clubIndex);
    if (bySignOff) return { club: bySignOff, via: 'signoff' };
    // 5 · a club named in the body, but ONLY where the sentence says it is RUNNING the thing. A bare
    //     mention is worthless and actively harmful: measured over a year, plain body matching produced
    //     "Cognizance" from "please take cognizance of", "Fine Arts" from "students from fine arts,
    //     design and architecture", "Thomso" from a date in the academic calendar, and "Wellness" from
    //     a needs-based scholarship — roughly half of its hits were wrong. Requiring an organiser cue
    //     keeps the real ones ("BlocSoc IITR is here to decode them all", "the ArIES Workshop Series").
    const byBody = clubOrganiserInBody(email.body_text, clubIndex);
    if (byBody) return { club: byBody, via: 'body' };
    // 6 · a club's OWN address sitting in Cc. A club routinely mails through a broadcast list and
    //     copies itself, so From is only the relay and the club appears nowhere except the Cc line —
    //     cinesec@iitr.ac.in reaches students exactly that way. This is an EXACT address match, not a
    //     text guess, so it beats falling through to the forwarder or to Institute.
    //
    //     Placed BELOW the text tiers on purpose: for a relay, a club named in the subject is the
    //     organiser, while Cc can carry several parties at once (a dean, a council, a co-host). It is
    //     therefore used only when the Cc resolves to EXACTLY ONE club — two candidates means the mail
    //     does not say who is running it, and guessing would put the event on the wrong club's page.
    const ccClubs = [...new Set(addrList(email.cc)
        .filter((a) => a !== from && !CFG.relaySenders.includes(a))
        .map((a) => (byEmail && byEmail.get(a)) || (CFG.clubExtraAddresses || {})[a] || (senderMap && senderMap[a]))
        .filter(Boolean))];
    if (ccClubs.length === 1) return { club: ccClubs[0], via: 'cc' };

    // 7 · a relay whose text named nobody: the admin-taught map is the forwarder, which is a better
    //     answer than Institute for a council that only ever forwards its own domain's mail.
    if (isRelay && senderMap && senderMap[from]) return { club: senderMap[from], via: 'sender_relay' };

    return { club: 'Institute', via: 'fallback' };
}

// Trust hint (NOT a gate): a sender is "verified" if admin-taught (in the map), a known relay, or its
// local-part looks institutional (an office/dean/club). A random personal/rollnumber address → unverified
// → badged in review so the admin double-checks a proposal from someone who isn't a recognized entity.
function senderVerified(email, senderMap) {
    const from = addr(email.from);
    if (senderMap && senderMap[from]) return true;
    if (CFG.relaySenders.includes(from)) return true;
    return CFG.institutionalSenderCues.test(from.split('@')[0]);
}

// ── Classify (intent-based) ──────────────────────────────────────────────────
function categoriesFor(text) {
    const cats = [];
    for (const r of CFG.categoryRules) if (r.re.test(text) && !cats.includes(r.cat)) cats.push(r.cat);
    return cats;
}
// The text categories are decided FROM — the title plus the cleaned description, never the raw body.
// Signatures, footers and quoted replies routinely carry a stray "training"/"match"/"cup" that has
// nothing to do with the event: a puppetry recital picked up "Sports & Fitness" that way. Falls back
// to the cleaned top message when no description was derived (never to the raw body).
function categoryText(email, fields) {
    const body = (fields && fields.description)
        || cleanBody(topMessage(email.body_text || '')).text
        || '';
    return `${(fields && fields.title) || ''}\n${body}`;
}
// Deterministic notice KIND (scholarship|recruitment|competition|fee|registration|resource|facility|deadline|notice).
// Returns { key, label, cls, opportunity }. First tight-regex match wins; deadline/notice are fallbacks.
function classifyNoticeKind(blob, { hasDeadline } = {}) {
    for (const k of CFG.noticeKinds) if (k.re.test(blob)) return k;
    if (hasDeadline) return { key: 'deadline', label: 'Deadline', cls: 'k-deadline', opportunity: true };
    return { key: 'notice', label: 'Notice', cls: 'k-notice', opportunity: false };
}

function classify(email) {
    const from = addr(email.from);
    const subj = stripSubject(email.subject);
    const blob = `${subj}\n${email.body_text || ''}`;
    // calendar DAY-STATUS first (holiday / working-teaching day / timetable) — the only email→calendar
    // writes. Exam schedules & "academic calendar" notifications are NOT here → they fall through to notice.
    if (CFG.calendarDaySubjects.test(subj)) {
        return { type: 'calendar', calKind: CFG.calendarHolidayCues.test(blob) ? 'holiday' : 'working' };
    }
    const hasDeadline = CFG.deadlineCues.test(blob);
    // An ONLINE session has a place too — "Meeting Link:" / a Meet-Zoom-Teams URL. venueTokens alone
    // missed those (it lists building codes and a few platform names), so a masterclass whose only
    // location was a Google Meet link counted as venue-less and fell through to notice.
    const hasVenue = CFG.venueTokens.test(blob) || CFG.onlineVenueCues.test(blob);
    const hasAttend = CFG.attendCues.test(blob);
    const isScholarship = CFG.scholarshipCues.test(blob);
    // Use the SAME date resolution as extract(): absolute, then a yearless day+month, then
    // "today/tonight/tomorrow" against the send date. classify() previously demanded a 4-digit year,
    // so "Time: Today, May 23 | 5:00 PM" scored as date-less and a real event became a notice — the
    // classifier was strictly weaker than the extractor that runs right after it.
    const startDate = parseDates(blob, email.internal_date).startDate
        || yearlessDate(blob, email.internal_date)
        || relativeDate(blob, email.internal_date);
    const isRecruitment = CFG.recruitmentCues.test(blob);
    // event = expected to attend something: attend-intent OR a venue, plus a date OR a venue.
    // (a venue satisfies both halves — a room+no-date poster is still an event.)
    const isEventShaped = (hasAttend || hasVenue) && (startDate || hasVenue);
    // Opportunity intents (recruitment / scholarship / fellowship) are apply-by NOTICES by default —
    // an *announcement* you apply to. They become EVENTS only when the SUBJECT frames the mail as an
    // attend-format gathering: "Recruitment TALK / Orientation / Test" = event; "Recruitment
    // announcement / drive / applications open" or "Fellowship advertisement" = notice. (Match on the
    // SUBJECT only — announcements routinely mention a test/interview in the BODY as part of process.)
    const isAttendFormat = CFG.attendFormatCues.test(subj);
    if (isScholarship) return { type: isAttendFormat ? 'event' : 'opportunity' };
    if (isRecruitment) return { type: isAttendFormat ? 'event' : 'opportunity' };
    if (isEventShaped) return { type: 'event' };
    if (hasDeadline) return { type: 'opportunity' };
    return { type: 'notice' };
}

// ── Extract ──────────────────────────────────────────────────────────────────
// A usable event title. When the subject is a generic one-word ("lecture", "invitation", "reminder")
// or too short, mine the body: prefer a "Topic:/Title:" line, then "<talk/lecture> by Dr. X", else subject.
function deriveTitle(subj, body) {
    const s = (subj || '').trim();
    const generic = /^(lecture|talk|seminar|webinar|colloquium|invitation|invite|reminder|notice|circular|event|update|information|meeting|fwd|re)s?\.?$/i;
    const invite = /\b(?:cordially|warmly)\s+invit|you are invited|we invite you|invitation to attend/i;
    if (s.length >= 12 && !generic.test(s) && !invite.test(s)) return s;    // subject is already descriptive
    // invitation-sentence subject → strip the preamble, keep the substance ("…invited to attend the X" → "X")
    if (invite.test(s)) {
        const stripped = s.replace(/^.*?\binvit(?:e|es|ed|ation)\b[^.]*?\b(?:to\s+(?:attend|join|participate in|be present at|grace)\s+)?(?:an?|the)\s+/i, '').trim();
        if (stripped.length >= 10 && stripped.length < s.length) return stripped;
    }
    let topic = (body.match(/(?:topic|title)\s*[:\-]\s*([^\n]{6,140})/i) || [])[1];
    if (topic) {
        topic = topic.replace(/\.\s.*$/, '')                                                        // stop at first sentence end
            .replace(/\s+(?:it will|this |kindly|all are|please|for (?:details|the)|registration|attendance|the talk|venue|date|time).*$/i, '')  // common continuations
            .replace(/\s+/g, ' ').trim();
        if (topic.length >= 6) return topic;
    }
    const by = (body.match(/\b((?:invited\s+|guest\s+)?(?:talk|lecture|seminar|webinar)\s+by\s+(?:dr|prof|mr|ms|mrs|shri|smt)\.?\s+[A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+){0,2})/i) || [])[1];
    if (by) return by.replace(/\s+/g, ' ').trim();
    return s || null;
}

const _MON = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const looksDateStr = (s) => new RegExp(`\\b(\\d{1,2}(?:\\s*[-–]\\s*\\d{1,2})?(?:st|nd|rd|th)?\\s*(?:${_MON})[a-z]*|(?:${_MON})[a-z]*\\s*\\d{1,2}|\\d{1,2}[\\/.]\\d{1,2}(?:[\\/.]\\d{2,4})?|(?:mon|tues?|wednes|thurs?|fri|satur|sun)day|today|tomorrow)\\b`, 'i').test(s);
const looksTimeStr = (s) => /\b\d{1,2}[:.]\d{2}\s*(?:hrs?|hours?)?|\b\d{1,2}(?::\d{2})?\s*(?:a\.?m|p\.?m|noon)|\b\d{3,4}\s*hrs?\b/i.test(s);

// Force a title to be a short HEADLINE, never a sentence (description carries the prose) — while KEEPING
// the essentials. "<X> will/would be delivered/held by <Y>" → "<X> by <Y>" (the speaker is necessary info,
// so it's preserved, not dropped); a trailing auxiliary/relative clause is cut; a bloating trailing
// (dept/org/year) parenthetical is dropped only once the title is already long; then a generous word/char
// cap on a word boundary. Deterministic-fallback safety — Groq authors "name" short upstream, but this
// guarantees even the fallback (or a stray Groq sentence) never publishes a paragraph as the title.
function headline(s) {
    if (!s) return s;
    let x = s.replace(/\s+/g, ' ').trim();
    x = x.replace(/\s+(?:would|will|shall|is|are)\s+be\s+(?:deliver|giv|present|held|conduct|organi[sz]|host|address)[a-z]*\s+by\s+/i, ' by ');
    x = x.replace(/\s+(?:which|that|wherein|whereby|will\s+be|would\s+be|shall\s+be|is\s+being|are\s+being|it\s+will|this\s+will|and\s+(?:it|this))\b.*$/i, '');
    if (x.length > 70) x = x.replace(/\s*[([][^)\]]*[)\]]\s*$/, '').trim();     // drop trailing dept/org paren when long
    const words = x.split(' ');
    if (words.length > 16) x = words.slice(0, 16).join(' ');                    // ~headline length, keeps subject+speaker
    if (x.length > 100) x = x.slice(0, 100).replace(/\s+\S*$/, '');
    x = x.replace(/\s*[([][^)\]]*$/, '').replace(/[\s,;:_|–—@-]+$/, '').trim(); // tidy any dangling unclosed bracket / sep
    return x || s.trim();
}

// The event NAME must carry NO date/time — those are separate structured fields. Repeatedly peel a
// TRAILING "[separator] <date/time-ish tail>" and drop parenthesized date/time chunks. Trailing-only,
// deterministic — never touches mid-prose ("July Lecture Series" survives). Finally headline()-capped so
// the NAME is always a short title, never a full sentence.
function cleanTitle(t) {
    if (!t) return null;
    let x = t.trim().replace(/^\s*save the date\s*[:\-]\s*/i, '');
    x = x.replace(/\s*[([][^)\]]{0,45}[)\]]/g, (m) => (looksDateStr(m) || looksTimeStr(m)) ? '' : m);
    let prev;
    do {
        prev = x;
        x = x.replace(/[\s,_|:–—-]+(?:on\s+|at\s+|dated\s+|@\s*)?((?:mon|tue|wed|thu|fri|sat|sun|today|tomorrow|\d)[^,_|]*)$/i,
            (m) => (looksDateStr(m) || looksTimeStr(m)) ? '' : m);
    } while (x !== prev);
    x = x.replace(/\s{2,}/g, ' ').replace(/[\s,;:_|–—@-]+$/, '').replace(/^[\s,;:_|–—-]+/, '').trim();
    return headline(x) || t.trim();
}

// Description = a cleaned body summary (NEVER the title, and free of the labeled logistics lines that
// are already separate fields). Drops Venue:/Date:/Time:/Topic: labels, greetings, signatures, links.
function deriveDescription(body) {
    // Prose only: cleanBody has already dropped ceremony, so here we additionally drop the labelled
    // logistics lines (Venue:/Date:/Time:) because those are separate structured fields.
    // stripQuotedHeaders FIRST: the date/venue extraction already ran the body through it, but the
    // description did not, so a reply's attribution line leaked straight onto the student-facing card —
    // "…5:00 PM. On Mon, Aug 10, 2026 at 9:49 PM General Secretary <gensec…> wrote:". Nothing that
    // reads as an email header belongs in a description.
    const { text } = cleanBody(stripQuotedHeaders(body));
    const kept = text.split('\n').map((l) => l.trim())
        .filter((l) => l.length > 20 && !LABEL_LINE.test(l) && !BULLET_LINE.test(l));
    let d = kept.join(' ').replace(/\s+/g, ' ').trim();
    if (d.length > 500) d = d.slice(0, 497).replace(/\s+\S*$/, '') + '…';
    return d.length >= 40 ? d : null;                                    // empty beats noise
}

// ── Body cleaning ────────────────────────────────────────────────────────────
// Campus mail is roughly 40% ceremony: a salutation, the content, then a signature block carrying a
// designation, department, phone and postal address. cleanBody() keeps the content and the STRUCTURE
// (bullets, "Label: value" lines) and drops the rest. It is line-based, which only works because
// ingestion preserves newlines — see normalizeLines() in source/gmail.js.
const SALUTATION = /^\**\s*(dear|respected|hi|hello|greetings)\b[^.!?]{0,70}$/i;
const SIGNOFF = /^\**\s*(regards|best regards|warm regards|kind regards|with regards|thanks|thanks and regards|thanks & regards|thank you|sincerely|yours (sincerely|faithfully|truly)|cheers|best wishes|with best wishes|with warm regards|-{2,})\b/i;
const SIG_LINE = new RegExp([
    /^(prof|dr|shri|smt|mr|ms|mrs)\.?\s+\S/.source,
    /\b(head|dean|chairman|chairperson|convener|convenor|coordinator|co-ordinator|registrar|director|warden|professor|assistant professor|associate professor)\b/.source,
    /\b(department of|dept\.?\s|indian institute of technology|iit\s*roorkee|roorkee\s*[-–]\s*\d|pin\s*[-:]?\s*\d{6}|uttarakhand)\b/.source,
    /^(tel|telephone|phone|mob|mobile|fax|email|e-mail|web|website|off)\s*[:.]/.source,
    /^\+?\d[\d\s\-()]{8,}$/.source,
].join('|'), 'i');
const DISCLAIMER = /\b(confidential|intended recipient|privileged (information|and confidential)|this e-?mail (and any|is intended)|disclaimer|unsubscribe|you (are )?receiv(ed|ing) this (e-?mail|message))\b/i;
const IMG_REF = /^\[?(image|cid)\s*:/i;
const BARE_URL = /^<?https?:\/\/\S+>?$/i;
const QUOTE_LINE = /^>/;
const BULLET_LINE = /^([*•▪◦‣·o]|[-–—]|\d+[.)])\s+\S/;
// same markers, but WITHOUT consuming the first content character (BULLET_LINE ends in \S)
const BULLET_PREFIX = /^([*•▪◦‣·o]|[-–—])\s+/;

// Organiser contact lines — "Vivek - 9000000003", "For queries contact Kartik 9000000007". A student
// deciding whether to apply needs the deadline and the link, not two mobile numbers, and republishing
// personal numbers ages badly. These arrive formatted as bullets, so the signature filter (which
// deliberately exempts bullets to protect real list content) lets them through.
// Deliberately narrow: fires only when the line is ESSENTIALLY a name plus a number, so
// "Eligibility: 2nd & 3rd Year Students" and "First Prize - Rs 15,000" survive untouched.
const PHONE = /(?:\+?91[\s-]?)?\b\d{10}\b|\b\d{5}[\s-]\d{5}\b|\+?\d[\d\s()-]{9,}\d/;
// Words that look like a name to the capitalisation test but are really labels on a phone number.
const CONTACT_ROLE_WORD = /^(cell|off?ice|tel|ph|mob|mobile|whatsapp|helpline|landline|ext|extn|nos?|coordinator|convenor|convener|secretary|president)$/i;
function isContactLine(l) {
    if (!PHONE.test(l)) return false;
    const rest = l.replace(PHONE, ' ')
        .replace(/\b(contact|for queries|queries|reach out to|call|phone|mob(ile)?|whatsapp|no)\b/gi, ' ')
        .replace(/[^A-Za-z]+/g, ' ').trim();
    // A NAMED contact on a BROADCAST mail — "Nandini: 90000 00008", "CDT Prince (+91 9000000009)" — is
    // the club's published point of contact, and it is exactly what a student needs in order to ask
    // about the event, so it is KEPT. Only an UNNAMED number is noise: a bare "Contact +91 …" or an
    // office block like "Cell:09000000004; (O) 01332-285014" carries nothing a reader can act on.
    // Safe because the line only reaches here on mail that already cleared the broadcast gate and the
    // PII wall, and the sender's own signature block was removed above by signatureStart().
    const words = rest.split(/\s+/).filter(Boolean).filter((w) => !CONTACT_ROLE_WORD.test(w));
    return !words.some((w) => /^[A-Z][a-z]{2,}$/.test(w));      // no person-name left → drop
}
const LABEL_LINE = /^\**\s*(venue|location|date|dates|day|time|timing|topic|title|speaker|link|meeting link|register|registration|registration link|deadline|last date|eligibility|mode|theme|prize|prizes|reward|contact|duration|fee|fees|agenda|about)\s*\**\s*[:\-]\s*\S/i;

// A trailing signature is the maximal suffix of lines that are all "signature-ish". Detected from the
// END so a mid-body "Thanks for your interest" never truncates real content.
function signatureStart(lines) {
    const siggy = (l) => !l || SIGNOFF.test(l) || SIG_LINE.test(l) || BARE_URL.test(l)
        || DISCLAIMER.test(l) || IMG_REF.test(l) || /^\S+@\S+\.\S+$/.test(l)
        || (l.length <= 45 && !/[.!?]$/.test(l) && !BULLET_LINE.test(l) && !LABEL_LINE.test(l));
    let k = lines.length;
    while (k > 0 && siggy(lines[k - 1])) k--;
    // only trust it if a sign-off actually opens the block, else we'd eat short real closing lines
    for (let i = k; i < lines.length; i++) if (SIGNOFF.test(lines[i])) return i;
    return lines.length;
}

// Outlook/html-to-text puts a list marker on its OWN line ("-\n\n   Amritapuri"). Rejoin those so the
// bullet survives, otherwise the item reads as loose prose and the list silently disappears.
const ORPHAN_MARKER = /^([*•▪◦‣·]|[-–—]|\d+[.)])$/;
function rejoinOrphanMarkers(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        if (ORPHAN_MARKER.test(lines[i])) {
            let j = i + 1;
            while (j < lines.length && !lines[j]) j++;
            if (j < lines.length) { out.push(`${lines[i]} ${lines[j]}`); i = j; continue; }
        }
        out.push(lines[i]);
    }
    return out;
}

// Campus mail is hard-wrapped at ~75 chars, so one sentence spans several lines. Merge a line back into
// the previous one unless the previous ended a sentence — without this, every downstream length filter
// mangles prose mid-sentence.
function reflow(lines) {
    const out = [];
    for (const l of lines) {
        const prev = out.length ? out[out.length - 1] : null;
        // a wrapped bullet continues INTO its bullet, so only the incoming line may not be a marker.
        // BUT a SHORT "Label: value" / bullet line is a complete item, not a wrapped fragment — the
        // only reason it doesn't end in punctuation is that nobody puts a full stop after
        // "Deadline: Saturday, 22nd August EoD". Without this guard it swallowed the following line and
        // published "• Deadline: Saturday, 22nd August EoD In case of any doubts, contact:".
        // Length is the discriminator: a genuinely wrapped line runs to the client's wrap width.
        // LABEL lines only — NOT bullets. Gmail flattens a TABLE into one cell per line, so a numbered
        // row marker legitimately continues into its own cells: "1. Fee Payment without late fine" +
        // "July 01, 2026 (10:00 AM)" + "to" + "July 13, 2026 (05:00 PM)" is ONE row, and treating the
        // marker as self-contained stripped every schedule row of its dates — the activity names
        // survived and the dates they refer to did not.
        const selfContained = (s) => LABEL_LINE.test(s) && s.length < 60;
        const joinable = prev && prev !== '' && l !== '' && !/[.!?:;]$/.test(prev)
            && !BULLET_LINE.test(l) && !LABEL_LINE.test(l) && !selfContained(prev);
        if (joinable) out[out.length - 1] = `${prev} ${l}`;
        else out.push(l);
    }
    return out;
}

// Gmail renders an HTML TABLE as ONE CELL PER LINE separated by blank lines, so a schedule row arrives
// as "1." / "Fee Payment without late fine" / "July 01, 2026 (10:00 AM)" / "to" / "July 13, 2026
// (05:00 PM)". reflow() never joins across a blank line, so the numbered row kept only its first cell
// and every DATE was orphaned into loose prose that `details` then filtered out — the academic
// registration notice listed four activities with none of the dates they referred to, which is the one
// thing a student needed from it.
// Merge trailing cells back into their row. Guarded three ways so ordinary prose after a list is not
// swallowed: it only runs when the block really is a table (>= 2 numbered rows), a cell must be short,
// and a row has a total length cap. A long paragraph ends the table.
function mergeTableRows(lines) {
    const isRow = (s) => /^\d+[.)]\s+\S/.test(s);
    if (lines.filter(isRow).length < 2) return lines;
    const CELL_MAX = 100, ROW_MAX = 300;
    const out = [];
    let cur = -1;
    for (const l of lines) {
        if (isRow(l)) { out.push(l); cur = out.length - 1; continue; }
        if (cur >= 0 && l && !LABEL_LINE.test(l) && !BULLET_LINE.test(l)
            && l.length <= CELL_MAX && out[cur].length + l.length + 1 <= ROW_MAX) {
            out[cur] = `${out[cur]} ${l}`;
            continue;
        }
        if (l) cur = -1;                    // a long line / another marker ends the run
        out.push(l);
    }
    return out;
}

// → { text, details }. `details` are the bullet / "Label: value" lines, in order, for compact display.
function cleanBody(raw) {
    // Gmail's text rendering writes a link as "[ https://very/long/url | Anchor text ]". The URL is
    // already captured into the link fields, so on a CARD it is pure noise — and at ~80 chars a piece it
    // pushed table rows past the length caps below, dropping them from the notice entirely. Keep the
    // anchor text, drop the URL. (A bare URL on its own line is still removed by BARE_URL further down.)
    const unlink = (l) => l.replace(/\[\s*(?:https?:\/\/|mailto:)[^\s|\]]+\s*\|\s*([^\]]+?)\s*\]/g, '$1');
    const unwrap = (l) => unlink(l).replace(/\*([^*\n]{1,90})\*/g, '$1').replace(/\s+/g, ' ').trim();
    // Drop a quoted email HEADER BLOCK (From:/To:/Sent:/Date:/Subject: together). When a whole message
    // is a forward, the "-----Original Message-----" marker sits at position 0, so the de-threading step
    // keeps everything — and the header's own "Date:" line then rendered as a bullet reading
    // "Date: Saturday, 11 July 2026 12:07 AM IST", i.e. the email's SEND time shown as if it were the
    // event's date. stripQuotedHeaders only removes such lines when 2+ appear together, so a club
    // mail's standalone "Date: 23 August" is untouched.
    let lines = rejoinOrphanMarkers(stripQuotedHeaders(String(raw || '')).split('\n').map(unwrap));
    lines = lines.slice(0, signatureStart(lines));
    const kept = [];
    for (const l of lines) {
        if (!l) { if (kept.length && kept[kept.length - 1] !== '') kept.push(''); continue; }
        if (QUOTE_LINE.test(l) || SALUTATION.test(l) || DISCLAIMER.test(l)) continue;
        if (isContactLine(l)) continue;                        // drops even when bullet/label-shaped
        if (IMG_REF.test(l) || BARE_URL.test(l)) continue;                 // URLs live in link fields
        // Length guard. SIG_LINE matches things a signature contains — "iit roorkee", "department of",
        // "Prof." — which are also things a campus email SAYS. Applied to a line of any length, it
        // discarded whole messages: HTML mail often arrives as ONE unbroken line, and
        // "The Corporate Interaction Group, IIT Roorkee, is excited to invite you to a Product
        // Management Masterclass…" (811 chars) was dropped in its entirety, publishing a notice with
        // no body at all. A real signature line is short; 200 chars separates the two cleanly here
        // (the longest genuine signature block in the corpus is 124).
        if (l.length <= 200 && SIG_LINE.test(l) && !BULLET_LINE.test(l) && !LABEL_LINE.test(l)) continue;
        kept.push(l);
    }
    while (kept.length && !kept[kept.length - 1]) kept.pop();
    const flowed = mergeTableRows(reflow(kept));
    const details = flowed.filter((l) => BULLET_LINE.test(l) || LABEL_LINE.test(l))
        .map((l) => l.replace(BULLET_PREFIX, '').trim())        // numbered bullets keep their "1." marker
        .filter((l) => l.length > 2);
    return { text: flowed.join('\n').trim(), details };
}

// Normalize a freeform time string → { time_start: "HH:MM" (IST 24h), duration_minutes }.
// "11 AM" → 11:00; "5:00 PM to 7:00 PM" → 17:00 + 120min; "5-7 PM" → 17:00 (start inherits end's meridiem).
function normTime(timeStr) {
    if (!timeStr) return { time_start: null, duration_minutes: null };
    // "10.30 a.m." → "10:30 am" (dot BETWEEN digits = separator; dots in a.m./p.m. dropped)
    const s = timeStr.toLowerCase().replace(/(\d)\.(\d)/g, '$1:$2').replace(/a\.?m\.?/g, 'am').replace(/p\.?m\.?/g, 'pm').trim();
    const parseOne = (str, inheritMer) => {
        str = str.trim();
        let m = str.match(/^(\d{2})(\d{2})\s*(?:hrs?|hours?)$/);          // "1830 hrs" → 24h HHMM
        if (m && +m[1] <= 23 && +m[2] <= 59) return { h: +m[1], min: +m[2], mer: null };
        m = str.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|noon|hrs?|hours?)?/);
        if (!m) return null;
        let h = +m[1]; const min = m[2] ? +m[2] : 0; const suf = m[3];
        let mer = (suf === 'am' || suf === 'pm') ? suf : inheritMer;
        if (suf === 'noon') { h = 12; mer = null; }
        if (mer === 'pm' && h < 12) h += 12;
        if (mer === 'am' && h === 12) h = 0;
        if (h > 23 || min > 59) return null;
        return { h, min, mer: (suf === 'am' || suf === 'pm') ? suf : null };
    };
    const hhmm = (o) => `${String(o.h).padStart(2, '0')}:${String(o.min).padStart(2, '0')}`;
    const parts = s.split(/\s*(?:to|till|until|–|—|-)\s*/).filter(Boolean);
    if (parts.length === 2) {
        const end = parseOne(parts[1]);
        const start = parseOne(parts[0], end && end.mer);                  // "5-7 PM": start inherits end's meridiem
        if (start) {
            let dur = null;
            if (end) { dur = (end.h * 60 + end.min) - (start.h * 60 + start.min); if (dur < 0) dur += 1440; dur = Math.max(15, Math.min(720, dur)); }
            return { time_start: hhmm(start), duration_minutes: dur };
        }
    }
    const one = parseOne(s);
    return one ? { time_start: hhmm(one), duration_minutes: null } : { time_start: null, duration_minutes: null };
}

// ONE SPELLING PER PLACE. "APJ-AKB 205" and "APJ–205" are the same room and must not become two
// venues. If nothing usable survives — off campus, or a non-answer like "IIT Roorkee" / "will be
// shared shortly" — the NAME is dropped but the fact that a physical event exists is not: the mode
// falls back to 'tba', which is precisely that state. Mutates in place; safe to call twice.
function canonicaliseVenue(p) {
    if (!p || !p.venue) return p;
    const canon = normalizeVenue(p.venue);
    if (canon) {
        p.venue = canon;
        if (/^online$/i.test(canon)) p.venue_mode = 'online';
    } else {
        p.venue = null;
        if (p.venue_mode === 'physical') p.venue_mode = 'tba';
    }
    return p;
}

function extract(email) {
    const subj = stripSubject(email.subject);
    const body = topMessage(email.body_text);
    const blob = `${subj}\n${stripQuotedHeaders(body)}`;
    const dates = parseDates(blob, email.internal_date);
    // time — captures a RANGE ("5-7 PM", "5:00 PM to 7:00 PM") or a single time.
    // Real corpus formats: "5:00 PM", "5.00 p.m." (dot-separated, ~60/500), "10 AM", "12 noon", ranges,
    // occasional "17:00 hrs". Separator is [:.]; meridiem may have dots ("a.m.").
    let time = firstMatch(blob, /\b\d{1,2}([:.]\s?\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|hrs?)?\s*(?:to|till|until|-|–|—)\s*\d{1,2}([:.]\s?\d{2})?\s*(a\.?m\.?|p\.?m\.?|hrs?)|\b\d{1,2}([:.]\s?\d{2})?\s*(a\.?m\.?|p\.?m\.?|noon|hrs?)/i);
    // Sanity: an hour above 23 (or above 12 with a meridiem) means we matched the middle of a
    // longer timestamp — "6:35:27 PM" yielded "35:27 PM". Drop it rather than show nonsense.
    if (time) {
        const h = parseInt(String(time).match(/\d{1,2}/)?.[0] ?? '', 10);
        const mer = /a\.?m|p\.?m/i.test(time);
        if (!Number.isFinite(h) || h > 23 || (mer && h > 12)) time = null;
    }
    // venue — an online meeting is still a "place" (Online); else a bounded building match (building
    // + optional room number, so it can't run on into "…on 9 Jan at 11am").
    // "in OP Jain Auditorium" was missed because only "at" was accepted; and "MAC Audi" came back as
    // bare "MAC" because the token match stopped at the acronym. Allow in/inside/venue-at, and let a
    // short trailing word ride along so "MAC Audi(torium)" survives intact.
    // (?![a-z]) after the building codes: without it, "Mathematics in Mac|hine Learning" matched "in Mac"
    // "APJ-AKB"/"APJAKB" are the same building as "APJ" and must come FIRST in the alternation, else
    // "APJ" matches and the room is left behind as the fragment "APJ-" (31 emails did this in a measured
    // year). The room is now an explicit 3-4 digit group after an optional separator or "Room No.",
    // rather than the old [-\d]{0,4} which could not cross the space in "APJ-AKB 205".
    // and The Integral Cup — an online maths contest — was given a venue of "Mac". A lookahead rather
    // than \b so "LHC001" (code immediately followed by digits) still matches.
    const venueMatch = firstMatch(blob, /(?:venue\s*:\s*|location\s*:\s*|\b(?:at|in|inside)\s+)((?:APJ[\s\-–]*AKB|APJAKB|APJ|LHC|LBS|MAC|OAT|S\d)(?![a-z])\s*(?:Audi[a-z]*|Block|Hall)?\s*(?:[-–,]?\s*(?:Room\s*(?:No\.?)?\s*)?\d{3,4})?|[A-Z][\w.]*\s*(?:Jain\s+)?Auditorium|Convocation Hall|Senate Hall|Seminar Hall|Lecture Hall|Amphitheatre|Auditorium|Academic Block|Room\s*(?:No\.?\s*)?\d+|Ground|Stadium)/i);
    // labeled "Venue: <freeform>" (e.g. "Conference Room, Civil Engg Dept"). Capture excludes quote/list
    // markers (> * |); then trim at a following Date/Time/label or a " - "/" & " clause so it can't run on.
    // Zimbra wraps values in *bold*, so "*Venue:* Mac Auditorium" and "*Venue: *Saraswati Mandir"
    // are both common. The old capture excluded '*' outright and silently lost 10% of labelled venues.
    const labeledVenue = (body.match(/venue\s*\**\s*[:\-]\s*\**\s*([^\n>|*]{3,70})/i) || [])[1];
    // A labelled venue is followed by ordinary prose far more often than not — every single labelled
    // venue in the 37-mail corpus ran on past the place into the next sentence, and the 70-char capture
    // then chopped it mid-word ("Outside MAC Auditorium. All students, research scholars, and staff mem").
    // Two structural cuts fix all of them without a keyword list that has to keep growing:
    //   · the first SENTENCE end — a venue is never two sentences.
    //   · the next "Label:" — campus mail stacks fields ("… Supervisors: Prof. X", "… Date & Time: 17th").
    //     Requires a Capitalised mixed-case word, so a venue that itself starts "LBS:" is not cut at its
    //     own label, and an all-caps building code survives.
    const cleanVenue = (v) => v
        .replace(/\.\s+.*$/, '')
        .replace(/\s+[A-Z][a-z]+(?:\s*&\s*[A-Z][a-z]+)?\s*:\s.*$/, '')
        .replace(/\s+(?:date|time|topic|speaker|day|contact|for details|register|agenda|major\s+activit|about\s+the|about\s+us|don'?t\s+miss|we\s+look|join\s+us|organi[sz]ed|entry|note|kindly|please|for\s+(?:any|more)).*$/i, '')
        .replace(/\s[-–&]\s.*$/, '')
        .replace(/[\s,;:\-–&]+$/, '').trim();
    // A venue is a place, not a sentence. "Venue: Will be communicated to the registered
    // participants." parsed as a location; so did values that ran on into the next paragraph.
    // …and a last backstop: a place name is short. Anything still over a dozen words after the cuts
    // above is prose that slipped through, and a wrong venue is worse than a blank one.
    const venueLooksLikePlace = (v) =>
        !!v && v.length <= 70 && v.split(/\s+/).filter(Boolean).length <= 12
        && !/\b(will be|to be|we |you |please|kindly|look forward|communicated|announced later|tba|tbd)\b/i.test(v);
    // VENUE MODE — three genuinely different states that must never collapse into one another:
    //   'online'   — it happens on Meet/Zoom/Teams/Webex; there is no room and never will be.
    //   'tba'      — a PHYSICAL event whose room is explicitly not decided yet ("venue will be
    //                communicated later", "venue: TBA"). A room exists; we just don't know it.
    //   'physical' — we have the actual room.
    //   null       — the email simply never mentioned a venue. Not the same as 'tba': one is a
    //                promise of a room to come, the other is silence, and the UI says different things.
    // An explicit ONLINE cue wins over everything: a webinar that says "link will be shared later" is
    // online, not TBA. A physical venue string wins over a TBA phrase, so "Venue: LHC 001 (room may
    // change)" stays LHC 001. Order below encodes exactly that precedence.
    // A venue field that names a DIFFERENT place on each day — "Venue: 16th August: SAC OAT | 5:30 PM
    // onwards 📍 17th August: MAC OAT | 6:00 PM onwards". The ordinary capture below excludes '|', so it
    // kept day one only and silently sent everyone to the wrong hall on day two. Recognised by SHAPE —
    // two dated segments joined by '|' or 📍 — which ordinary prose and every single-venue string in a
    // measured year fail to match, so nothing else can take this path. normalizeVenue() splits it back
    // apart and re-attaches each day. Rare (2 of 213 venue-stating emails), but wrong in a way a student
    // pays for by standing outside the wrong building.
    const MULTI_DAY_VENUE = new RegExp(String.raw`\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*[:\-–][^\n]{2,60}?[|📍][^\n]{0,30}?\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)`, 'iu');
    const venueLine = (body.match(/venue\s*\**\s*[:\-]\s*\**\s*([^\n]{3,200})/i) || [])[1];
    const multiDayVenue = venueLine && MULTI_DAY_VENUE.test(venueLine) ? venueLine.trim() : null;

    const physicalVenue = multiDayVenue ? multiDayVenue : venueMatch
        ? venueMatch.replace(/^(venue\s*:\s*|location\s*:\s*|(?:at|in|inside)\s+)/i, '').trim()
        : (labeledVenue ? ((v => venueLooksLikePlace(v) ? v : null)(cleanVenue(labeledVenue)) || null) : null);
    // a multi-day venue is a stated PLACE, so it must not be read as "venue not decided yet" — the
    // truncated single-day capture below looks prose-like and would otherwise force mode 'tba'.
    const venueDeferred = !multiDayVenue && CFG.venueTbaCues.test(blob)
        || (!multiDayVenue && !!labeledVenue && !venueLooksLikePlace(cleanVenue(labeledVenue)));   // "Venue: will be communicated"
    // A stated offline/in-person/hybrid mode beats an online cue — see offlineVenueCues. A named room
    // does too: an email that gives you LHC 001 is not an online event, whatever links it also carries.
    const isOnline = CFG.onlineVenueCues.test(blob)
        && !CFG.offlineVenueCues.test(blob)
        && !physicalVenue;
    const venue_mode = isOnline ? 'online'
        : physicalVenue ? 'physical'
            : venueDeferred ? 'tba'
                : null;
    // `venue` stays the human-readable string the rest of the system already consumes.
    const venue = venue_mode === 'online' ? 'Online'
        : venue_mode === 'physical' ? physicalVenue
            : null;                       // 'tba' and null both have no place NAME — venue_mode tells them apart
    // The generic link must come from the MESSAGE, not the sender's sign-off. firstLink() took the first
    // URL in the whole blob, so a Civil Engineering talk published the coordinator's personal faculty
    // page (civil.iitr.ac.in/CE?Uid=…, sitting in the signature) as the event's link — a student
    // clicking through lands on a staff profile instead of the event. Cut the signature first.
    // registration_link is left on the full blob on purpose: it only matches forms.gle / Google Forms /
    // unstop / channeli, none of which appear in a signature.
    const bodyLines = String(body || '').split('\n');
    const bodyNoSig = bodyLines.slice(0, signatureStart(bodyLines)).join('\n');
    const link = contentLink(`${subj}\n${bodyNoSig}`);
    const registration_link = regLink(blob);
    const detailInAttachment = /refer to the (flyer|poster|attach)|see attached|poster (attached|below)|in the poster/i.test(body);
    // AUDIENCE is a coarse badge, so it must come from an ELIGIBILITY STATEMENT — not from any stray
    // mention of a year anywhere in the mail. Scanning the whole blob for the first year-ish token made
    // a contest that assigns a THEME per year ("1st Year — मूर्खः", "2nd Year — मित्रम्") publish as
    // audience "1st Year", telling every other year they were excluded from something explicitly
    // "Open to: B. Tech., M. Tech. & Ph.D. students". Wrong beats missing here: require a cue within a
    // short window before the token, and leave it null otherwise.
    // Two classes of token, because only one of them is ambiguous:
    //  · SELF-EVIDENT ("girls only", "freshers", "hostel residents") — these ARE audience statements
    //    wherever they appear; nobody writes "girls only" except to restrict an audience.
    //  · YEAR tokens ("1st year", "final year") — these appear all over campus mail for other reasons
    //    (a per-year theme list, a syllabus, a results table), so they need an eligibility cue nearby.
    const AUD_SELF = /\b(freshers?|girls only|women students?|graduands?|hostel residents?)\b/i;
    // "pg students" is NOT self-evident: "FOR ALL EXISTING UG & PG STUDENTS" matched it and published
    // audience "PG STUDENTS", telling every UG student the notice was not theirs. It needs a cue like
    // the year tokens do, and it is dropped outright when UG and PG are named together (= everyone).
    const AUD_YEAR = /\b(1st[-\s]?year|first[-\s]?year|final year|2nd[-\s]?year|second[-\s]?year|pg students?)\b/i;
    const BOTH_UG_PG = /\bug\b[^.\n]{0,12}(?:&|and|\/)[^.\n]{0,12}\bpg\b|\bpg\b[^.\n]{0,12}(?:&|and|\/)[^.\n]{0,12}\bug\b/i;
    const AUD_CUE = /\b(?:open(?:\s+only)?\s+(?:to|for)|only\s+for|meant\s+for|exclusively\s+for|restricted\s+to|limited\s+to|eligibility|eligible|invited\s+from|applicable\s+(?:to|for))\b[^.\n]{0,40}?/i;
    const audBlob = subj + body;
    const audRaw = firstMatch(audBlob, AUD_SELF)
        || ((m) => (m ? m[1].trim() : null))(new RegExp(AUD_CUE.source + AUD_YEAR.source, 'i').exec(audBlob));
    // Naming both cohorts means "everyone" — no badge is better than a badge that excludes half of them.
    const audience = (audRaw && /pg students?/i.test(audRaw) && BOTH_UG_PG.test(audBlob)) ? null : audRaw;
    // A registration deadline that is the earliest date means parseDates mistook it for the event
    // start — promote the later (event) date to startDate so the two don't collide.
    let registration_deadline = registrationDeadline(blob);
    // Fallback: an explicitly LABELLED deadline the sentence-scoped rule above doesn't reach
    // ("Registration deadline: 10th July 2026", "The last date to apply online is August 03, 2026").
    if (!registration_deadline) {
        const dm = blob.match(DEADLINE_LABEL);
        const dtxt = dm && (dm[1] || dm[2]);
        if (dtxt) registration_deadline = parseDates(dtxt).startDate || null;
    }
    const speaker = speakerOf(blob);
    const meeting_link = cleanUrl((blob.match(MEET_LINK) || [])[1] || null);
    const em = blob.match(ELIGIBILITY);
    const eligibility = em ? (em[1] || em[2] || '').replace(/\s+/g, ' ').replace(/[\s.;,-]+$/, '').trim() || null : null;
    let startDate = dates.startDate || null;
    let endDate = dates.endDate || null;
    if (registration_deadline && registration_deadline === startDate) {
        startDate = endDate;   // the earliest date was the deadline; the event is the later one
        endDate = null;
    }
    // Nothing absolute anywhere? Fall back to "tonight/tomorrow" resolved against the sent date.
    let relativeResolved = false;
    if (!startDate) {
        // an explicit day+month whose year was simply omitted comes first — it is more specific
        const yl = yearlessDate(blob, email.internal_date);
        if (yl) { startDate = yl; relativeResolved = true; }
    }
    if (!startDate) {
        const rel = relativeDate(blob, email.internal_date);
        if (rel) { startDate = rel; relativeResolved = true; }
    }
    const tentative = !startDate || relativeResolved || detailInAttachment || /\btba\b|\btbd\b|to be (announced|decided)/i.test(blob);
    const { time_start, duration_minutes } = normTime(time);
    // Closing time of the apply-by, normalized the same way. Only meaningful alongside a deadline date.
    const deadline_time = normTime(deadlineTimeOf(blob)).time_start;
    return canonicaliseVenue({
        title: cleanTitle(deriveTitle(subj, body)),   // NAME only — no date/time/venue baked in
        description: deriveDescription(body),          // separate, cleaned; null if it'd be noise
        startDate: startDate || null,
        endDate: endDate || null,
        registration_deadline: registration_deadline || null,
        deadline_time: deadline_time || null,          // "HH:MM" the apply-by closes; null = end of day
        time: time || null,                            // raw display string (kept for provenance)
        speaker,                                       // "Prof. Kaushik Ghosh" — campus mail is talk-heavy
        meeting_link,                                  // Meet/Zoom/Webex join URL, distinct from registration
        eligibility,                                   // free text; audience stays the coarse enum
        time_start: time_start || null,                // normalized "HH:MM" IST — sets the real start time
        duration_minutes: duration_minutes || null,
        venue: venue || null,
        venue_mode: venue_mode,            // online | physical | tba | null — see the block above
        link: link || null,
        registration_link: registration_link || null,
        audience: audience || null,
        tentative,
        detailInAttachment,
    });
}

// A notice body is a SHORT summary plus the handful of concrete lines worth keeping — never the whole
// email. `summary` is Groq's 1-2 sentence write-up when available; the deterministic fallback is the
// leading prose of the cleaned body. Details are the bullet / "Label: value" lines, capped.
const MAX_NOTICE_BODY = 900;
// CFG.deadlineCues is deliberately broad for CLASSIFICATION ("registrations are now open" → opportunity).
// It is far too broad to conclude that a bare date IS an apply-by, so promoting a startDate to a deadline
// needs an explicit closing phrase. Anything looser mislabels event dates and expires notices early.
const STRONG_DEADLINE_CUE = /last date|apply (by|before)|register (by|before)|submit (by|before)|deadline|on or before|clos(es|ing) (on|by)|due (on|by)/i;
function noticeBody(summary, cleaned, action = null) {
    const prose = cleaned.text.split('\n')
        .filter((l) => l && !BULLET_LINE.test(l) && !LABEL_LINE.test(l)).join(' ').replace(/\s+/g, ' ').trim();
    // Two sentences, always — Groq's summary is already that short, and the deterministic fallback
    // must not dump 500 characters of prose into a card that is supposed to be skimmable.
    const src = ((summary || '').trim() || prose).replace(/\s+/g, ' ').trim();
    // Sentence split that survives ABBREVIATIONS. `[^.!?]+[.!?]+` treats every period as a terminator,
    // so "…open to all IIT Roorkee B. Tech., M. Tech. & Ph.D. students." parsed as SEVEN sentences and
    // the two-sentence cap below published "…open to all IIT Roorkee B. Tech." — cut mid-clause, the
    // exact thing the cap exists to prevent. Campus mail is dense with these (B.Tech., M.Tech., Ph.D.,
    // Dr., Prof., No., a.m./p.m.) plus initials in speaker names ("Prof. S. N. Tandon"), so this fired
    // constantly. Mask the periods that belong to an abbreviation, split, then restore them.
    // NB longest alternatives FIRST — with `[A-Z]` leading, "B. Tech." masks only "B." and still breaks.
    const ABBR = /\b(?:B\.?\s?Tech|M\.?\s?Tech|B\.?\s?Arch|M\.?\s?Sc|B\.?\s?Sc|Ph|Dr|Prof|Mr|Mrs|Ms|Shri|Smt|Sr|Jr|St|No|Nos|Rs|Vs|vs|etc|approx|Dept|dept|Univ|univ|a\.m|p\.m|A\.M|P\.M|i\.e|e\.g|[A-Z])\./g;
    const DOT = '\u0001';
    const masked = src.replace(ABBR, (m) => m.replace(/\./g, DOT));
    const sentences = (masked.match(/[^.!?]+[.!?]+/g) || (masked ? [masked] : []))
        .map((s) => s.split(DOT).join('.'));
    let head = '';
    for (const sn of sentences.slice(0, 2)) {              // whole sentences only — never cut mid-clause
        const next = (head ? `${head} ` : '') + sn.trim();
        if (head && next.length > 320) break;
        head = next;
    }
    if (!head) head = src.slice(0, 300).trim();
    if (head.length > 320) head = head.slice(0, 319).replace(/\s+\S*$/, '') + '…';
    // 220, not 160: a reconstructed TABLE ROW carries its activity AND the dates it refers to
    // ("2. Academic Registration Step I … Step II … July 14, 2026 (09:00 AM) to July 15, 2026 (05:00 PM)"),
    // which runs past 160 — and dropping it took the dates with it, which is worse than a longer line.
    const details = cleaned.details.filter((d) => d.length <= 220).slice(0, 6)
        .map((d) => (/^\d+[.)]\s/.test(d) ? d : `• ${d}`));      // numbered items keep their own marker
    // The action line carries NO marker. It used to be written as "→ do this", but the card and the
    // detail view already render every line as a bullet, so the stored arrow surfaced as "• → Inform
    // the SCSP Office…". Nothing ever read the arrow back — it was decoration that leaked into the UI.
    // Terminated with a full stop so it cannot run into the paragraph that follows when a consumer
    // flattens the body to one line.
    const act = action ? action.replace(/^[→\-•\s]+/, '').trim() : '';
    const todo = act ? (/[.!?:;]$/.test(act) ? act : `${act}.`) : '';
    let out = [todo, head, details.join('\n')].filter(Boolean).join('\n\n').trim();
    if (out.length > MAX_NOTICE_BODY) out = out.slice(0, MAX_NOTICE_BODY - 1).replace(/\s+\S*$/, '') + '…';
    return out || null;
}

// Is this notice run by someone OTHER than IIT Roorkee?
//
// The Notices tab mixes a campus obligation with an outside competition you may choose to enter, and
// the card gives no clue which is which. This drives the EXTERNAL chip.
//
// Order matters, and it is not "check the domain first". Calibrated against all 38 live notices:
//   · "MemTechAI International Workshop" is hosted AT IIT Roorkee by the Hydrology department, so a
//     bare "international" cue gets it wrong.
//   · "99 Launchpad" is run by TIDES — IITR's own incubator — but its form lives on a third-party
//     host (tides.accubate.app), so a bare domain check gets it wrong too.
// Explicit "run/hosted/organised by <IITR>" or an "at IIT Roorkee" venue therefore OVERRIDES the
// domain, and the domain only speaks when the text says nothing either way.
function isExternalNotice(title, body, link) {
    const text = `${title || ''}\n${body || ''}`;

    // 1. IITR says it runs this → internal, whatever the link says.
    if (CFG.iitrRunCues.test(text)) return false;

    // 2. A link on our own estate is conclusive.
    let host = '';
    try { host = new URL(String(link)).hostname.replace(/^www\./, ''); } catch { host = ''; }
    if (host && CFG.iitrHosts.test(host)) return false;

    // 3. Named outside organiser, or a job at a named outside employer.
    if (CFG.externalOrgCues.test(text)) return true;
    if (CFG.externalEmployerCues.test(title || '')) return true;

    // 3b. "organised by <someone>" where the someone is not us. A named-body list can never be
    //     complete — "organized by Adamas University" was missed by every cue above simply because
    //     that university was not on any list. Step 1 has already returned for anything IITR runs, so
    //     reaching here with an explicit organiser means the organiser is somebody else.
    //     "sponsored by" is deliberately NOT in this list: a sponsor funds, it does not run. The
    //     Professional Development & Innovation Awards are "sponsored by the Class of 1983 alumni" and
    //     administered by the SCSP Office — as internal as a notice gets.
    const OURS = /iit\s*roorkee|iitr\b|tides\b|e-?cell\b|institute\b|alumni|class of \d{4}/i;
    const org = /\b(?:organi[sz]ed|hosted|conducted|presented|run)\s+by\s+(?:the\s+)?([^.,;:\n]{2,60})/i.exec(text);
    if (org && !OURS.test(org[1])) return true;

    // 3c. "forwarding an invitation FROM <someone>", and any named outside institution. The AU essay
    //     competition arrives as "I am forwarding an invitation from Adamas University" and never
    //     says "organised by" at all — no verb rule can see it, and no list of named bodies will ever
    //     contain every university that mails a campus list.
    const fwd = CFG.forwardedFromCues.exec(text);
    if (fwd && !OURS.test(fwd[1])) return true;
    if (CFG.externalInstitutionCues.test(text)) return true;

    // 4. A link on a third-party domain that is not a generic form/social host.
    if (host && !CFG.neutralHosts.test(host)) return true;

    // 5. Nothing said otherwise — assume it is ours. Campus mail is the default case, and a wrong
    //    EXTERNAL chip on a campus notice is more misleading than a missing one on an outside contest.
    return false;
}

// Does this notice earn the pinned IMPORTANT band? The test is CONSEQUENCE, not topic: does
// ignoring it cost the student something by default? See the cue block in iitr.config.js for the
// measurement that forced this rule (the previous one pinned 60% of notices, which is no signal).
//
// Cues are matched on the TITLE, not the body. Against the body they fired on any passing mention —
// a trek calendar planned "around holidays" and an alumni newsletter mentioning "degree" both pinned
// themselves to the top. The title is what the notice is ABOUT.
//
// Exported and used by BOTH the pipeline and the backfill script. Re-implementing this rule anywhere
// else is how the stored data drifts away from the code: the rule was corrected on 2026-08-22 and
// the rows written before that kept their old priority, leaving production at 66% important while
// the code computed 21%. One function, one definition.
function isImportantNotice(title, kindKey, isExternal = false, hasDeadline = false) {
    const t = title || '';
    // An outside body's CONTEST is never an institute obligation, so it never earns the band — however
    // much prize money or "applications invited" language it carries. That veto used to cover every
    // external item, which flattened a real distinction: an outside hackathon is optional fun, while an
    // outside RECRUITING deadline (Jane Street's SEE programme, closing 27 Sep) is a career event, and
    // for the students it targets it is the highest-value thing on the feed.
    //
    // So the veto now lifts for an external RECRUITMENT — but only one carrying a DEADLINE. Without a
    // date there is nothing to miss today, and "Launch of Yuva Sangam Phase VII", an undated government
    // programme announcement, would otherwise earn the same pin as a closing job application. The date
    // is what separates the two, not the word "recruitment". Competitions, quizzes and drone challenges
    // stay vetoed however they are dated.
    const externalCareer = kindKey === 'recruitment' && hasDeadline && !CFG.externalContestCues.test(t);
    if (isExternal && !externalCareer) return false;
    // An externally-run programme or contest is an opportunity, not an institute obligation.
    const outsideRun = CFG.externalContestCues.test(t) || CFG.externalProgramCues.test(t) || CFG.externalEmployerCues.test(t);
    return (
        kindKey === 'fee'
        || CFG.scholarshipCues.test(t)                       // money
        || CFG.adminActionCues.test(t)                       // an action the institute requires
        || CFG.disruptionCues.test(t)                        // something you'd otherwise walk into
        // A club / PoR recruitment is important; an outside programme that merely "invites
        // applications" is not — that distinction is why the band was useless before.
        || (kindKey === 'recruitment' && !outsideRun)
    );
}

// Build a CREATE_NOTICE payload (+ reason_codes) for a given opportunity/kind decision. Shared by
// the deterministic pipeline AND the runner's Groq-primary path so both produce identical shapes.
function noticePayload(email, { isOpportunity, kindKey, deadlineDate = null, deadlineTime = null, summary = null, action = null, calendarEntries = null } = {}) {
    const fields = extract(email);
    const noticeBlob = `${stripSubject(email.subject)}\n${email.body_text || ''}`;
    if (kindKey === undefined || isOpportunity === undefined) {
        const k = classifyNoticeKind(noticeBlob, { hasDeadline: !!isOpportunity });
        if (kindKey === undefined) kindKey = k.key;
        if (isOpportunity === undefined) isOpportunity = k.opportunity;
    }
    // WEAK_* reason codes (evidence-starvation / cross-category) — human-review hints, text-only.
    const cleaned = cleanBody(topMessage(email.body_text));
    const reasonCodes = [];
    if (cleaned.text.length < 50) reasonCodes.push('WEAK_TOO_SHORT');
    if (fields.detailInAttachment || /(find|see|refer to)[^.]{0,30}attach/i.test(noticeBlob)) reasonCodes.push('WEAK_ATTACHMENT_ONLY');
    if (/channel[- ]?i\b|channeli\.in|login to view|click here for details/i.test(noticeBlob)) reasonCodes.push('WEAK_LOGIN_LINK');
    if (!fields.startDate && !fields.venue) reasonCodes.push('WEAK_NO_TEMPORAL_INFO');
    if (reasonCodes.length && /^(notice|circular|information|invitation|important|update|reminder)s?\b/i.test(stripSubject(email.subject).trim())) reasonCodes.push('WEAK_GENERIC_SUBJECT');
    const eventCats = categoriesFor(noticeBlob).filter((c) => c !== 'Recruitments & PORs');
    if (['fee', 'registration', 'facility', 'resource'].includes(kindKey) && eventCats.length > 0) reasonCodes.push('AMBIG_CROSS_CATEGORY');
    // IMPORTANT = ignoring it costs you something by default. See the cue block in iitr.config.js for
    // the reasoning and the measurement that forced this rewrite (the old rule pinned 60% of notices).
    // Cues are matched on the TITLE, not the body. Against the body they fired on any passing mention —
    // a trek calendar planned "around holidays" and an alumni-story newsletter mentioning "degree" both
    // pinned themselves to the top. The title is what the notice is ABOUT.
    const noticeLink = fields.registration_link || fields.link;
    // A date the EMAIL states always wins; the calendar only fills a gap. Some campus mail states no
    // date at all and defers — "refer to the Academic Calendar (Autumn Semester 2026-27) for last date
    // for withdrawal of courses" — and the app has already parsed that calendar, so it holds the answer
    // the email is pointing at. Derived dates are stamped `deadline_source: 'calendar'` so they stay
    // distinguishable from stated ones, and so a later mail carrying a real date can override them.
    let resolvedDeadline = deadlineDate;
    let deadlineSource = null;
    // BACKSTOP: the mail states a deadline in plain words but the classifier returned none. Fill-only
    // and refuses on ambiguity — see statedDeadline.js for why a missing deadline is the costliest
    // failure here, and why picking between two candidate dates is worse than declining.
    if (!resolvedDeadline) {
        const stated = statedDeadline(`${fields.title || ''} ${email.body_text || ''}`);
        if (stated) {
            resolvedDeadline = stated.date;
            deadlineSource = 'stated';
        }
    }
    if (calendarEntries && calendarEntries.length) {
        const calText = `${fields.title || ''} ${email.body_text || ''}`;
        const derived = deadlineFromCalendar({ title: fields.title, body: calText, deadline: null }, calendarEntries);
        if (derived) {
            if (!resolvedDeadline) {
                resolvedDeadline = derived.date;
                deadlineSource = 'calendar';
            } else if (resolvedDeadline !== derived.date) {
                // The email states a date AND the calendar holds a confident answer for the same thing,
                // and they DISAGREE. Taking either silently is wrong: the email may be a deliberate
                // revision, or it may be stale or mistyped, and nothing in the text reliably separates
                // those two. So the email's date is still used — it is the more specific claim, and
                // deferring to the calendar would undo genuine corrections — but the disagreement is
                // raised for review instead of being swallowed.
                //
                // Unless the mail SAYS it is revising something. "Revised", "extended", "postponed" is
                // the institute deliberately superseding the published calendar, which is exactly the
                // case that must NOT be flagged as suspicious.
                const revising = /\b(revis(ed|ion)|extend(ed|ing|sion)|postpon(ed|ement)|resched(uled)?|updated|amend(ed|ment)|corrigendum|new date|now closes)\b/i.test(calText);
                if (!revising) reasonCodes.push(`CONFLICT_CALENDAR_SAYS_${derived.date}`);
            }
        }
    }
    // Detect against the ORIGINAL email text, not the trimmed card body — "run by TIDES Business
    // Incubator" and "at IIT Roorkee" routinely sit in sentences the summary drops.
    const isExternal = isExternalNotice(fields.title, `${summary || ''}\n${email.body_text || ''}`, noticeLink);
    const isImportant = isImportantNotice(fields.title, kindKey, isExternal, !!resolvedDeadline);
    return {
        evidence: reasonCodes.length ? { reason_codes: reasonCodes } : undefined,
        payload: {
            title: fields.title,
            body: noticeBody(summary, cleaned, action),
            source: senderName(email.from),
            priority: isImportant ? 'important' : 'general',
            kind: kindKey,
            is_opportunity: isOpportunity,
            link: noticeLink,
            is_external: isExternal,
            deadline: resolvedDeadline,
            deadline_source: deadlineSource,
            // Only meaningful with a date, and never invented for a derived one: the calendar gives a
            // day, not a clock time.
            deadline_time: deadlineSource ? null : (resolvedDeadline ? (deadlineTime || fields.deadline_time || null) : null),
            open_ended: /until further notice|applicable from|revised .*(timing|slot)/i.test(email.body_text || ''),
            audience: fields.audience,
        },
    };
}

// Does `next` carry scheduling detail that `prev` did not state at all?
//
// Campus mail routinely announces an event before it is scheduled ("Join us for an introductory
// session on Agentic AI" — no date, no time, no venue) and sends the logistics a day later on the
// SAME subject line ("Re: Intro to Agentic AI | SDSLabs — The lecture is scheduled for 12th August at
// 5:00 PM. Venue: APJ 103"). That follow-up carries no cancel/reschedule wording, so the subject-based
// 21-day dedup filed it as a plain repeat and DELETED it — the date, the time and the venue were all
// lost, and the item stayed on the feed as a date-less notice. This is that discriminator: a repeat
// says nothing new, a schedule announcement fills a field that was empty.
// Deliberately one-directional (empty → filled only). A follow-up that CHANGES an already-known time
// is a reschedule, which lifecyclePatchCues already handles and which must not be confused with this.
function addsSchedule(prev, next) {
    if (!prev || !next) return null;
    const a = extract(prev);
    const b = extract(next);
    const added = [];
    // FILLED a blank — the original never said when or where, the follow-up does.
    if (!a.startDate && b.startDate) added.push('date');
    if (!a.time_start && b.time_start) added.push('time');
    if (!a.venue && b.venue) added.push('venue');
    // CHANGED a value — "the talk will be held on 22 August" with no reschedule wording at all. This
    // used to count as nothing new, so the follow-up was binned as a duplicate and students kept the
    // old date. lifecyclePatchCues only fires on postponed/rescheduled/revised/new-date phrasing;
    // plainly restating the new details is just as common and was silently lost.
    if (a.startDate && b.startDate && a.startDate !== b.startDate) added.push('date_changed');
    if (a.time_start && b.time_start && a.time_start !== b.time_start) added.push('time_changed');
    if (a.venue && b.venue && a.venue.toLowerCase() !== b.venue.toLowerCase()) added.push('venue_changed');
    return added.length ? added : null;
}

// Carry forward what the FOLLOW-UP does not say but the ORIGINAL did.
//
// A reply that supplies the logistics ("The lecture is scheduled for 12th August at 5:00 PM. Venue:
// APJ 103") is three lines long. Everything that makes the item worth attending — the description, the
// registration link, the speaker — was in the first mail, and is either quoted (so stripped as noise)
// or absent. The published event then had a real date and no substance.
//
// STRICTLY ADDITIVE: only ever fills a field the follow-up left empty, never overwrites one it stated.
// So a reply that changes the venue still wins, and nothing that already works can regress.
const CARRY_FIELDS = [
    'description', 'link', 'registration_link', 'meeting_link', 'speaker',
    'eligibility', 'audience', 'venue', 'venue_mode', 'registration_deadline', 'deadline_time',
];
function carryForward(payload, priorEmail) {
    if (!payload || !priorEmail || !priorEmail.body_text) return payload;
    const prev = extract(priorEmail);
    const out = { ...payload };
    const filled = [];
    for (const k of CARRY_FIELDS) {
        if ((out[k] === undefined || out[k] === null || out[k] === '') && prev[k]) { out[k] = prev[k]; filled.push(k); }
    }
    // DESCRIPTION is the one field where "the follow-up said something" is not enough. A logistics
    // reply produces a description that merely restates the structured fields — "The lecture is
    // scheduled for 12th August at 5:00 PM." — which is worse than useless on a card that already
    // shows the date and time. When the original carries real prose and the follow-up's is a short
    // restatement, prefer the original. Threshold, not a keyword list: a genuine description written
    // in a reply will be substantial and keeps precedence.
    const RESTATEMENT_MAX = 120;
    if (prev.description && (!out.description
        || (out.description.length <= RESTATEMENT_MAX && prev.description.length > out.description.length * 1.5))) {
        if (out.description !== prev.description) { out.description = prev.description; if (!filled.includes('description')) filled.push('description'); }
    }
    if (filled.length) out._carried_from_original = filled;
    return out;
}

// Lifecycle: is this a follow-up that CHANGES a prior item (cancel / reschedule / revised date-venue)?
function detectLifecycle(email) {
    const blob = `${stripSubject(email.subject)}\n${email.body_text || ''}`;
    if (CFG.lifecycleCancelCues.test(blob)) return { type: 'CANCEL_EVENT', kind: 'cancel' };
    // Checked BEFORE the event-reschedule cues: "Last date extended to 25 Aug" also contains a date
    // change, and without this ordering it would be filed as a club-event reschedule and applied to
    // the wrong thing. A moved apply-by belongs to a NOTICE.
    if (CFG.deadlineExtendCues.test(blob)) return { type: 'PATCH_NOTICE', kind: 'deadline_extended' };
    // timeShift marks the date/time-moving subset. runPipeline uses it to decide whether a patch that
    // states no new value is really an open-ended postponement; a venue-only change never qualifies.
    if (CFG.lifecyclePatchCues.test(blob)) {
        return { type: 'PATCH_EVENT', kind: 'reschedule', timeShift: CFG.lifecycleTimeShiftCues.test(blob) };
    }
    // LAST, so anything that names a replacement date has already been claimed above. What reaches
    // here is an open-ended postponement — the item is off, and the mail does not say when it returns.
    // Treated as a cancellation because there is no new value to patch with; the re-announcement,
    // when it comes, is a fresh announcement rather than an update to this one.
    if (CFG.lifecyclePostponeCues.test(blob)) return { type: 'CANCEL_EVENT', kind: 'postponed' };
    return { type: null };
}

// ── Orchestrate ──────────────────────────────────────────────────────────────
function runPipeline(email, { senderMap, clubIndex, calendarEntries } = {}) {
    const gate = passesGates(email);
    if (!gate.ok) return [{ mutation_type: 'DISMISS', reason: gate.reason }];

    const cls = classify(email);
    const fields = extract(email);
    const attr = attribute(email, senderMap, clubIndex);

    // 1. CALENDAR day-status (holiday / working / timetable) takes precedence — a "rescheduling of
    // teaching day" is a calendar amend, NOT a club-event patch. The reviewer amends/adds a calendar row.
    if (cls.type === 'calendar') {
        return [{
            mutation_type: 'CALENDAR_ENTRY',
            payload: { ...fields, cal_kind: cls.calKind },   // holiday | working
        }];
    }

    // 2. A cancellation / reschedule of a club EVENT — emit a typed lifecycle mutation the reviewer
    // can apply against the prior item (the runner links it to the superseded email when it can).
    const lc = detectLifecycle(email);
    if (lc.type === 'PATCH_NOTICE') {
        // A moved apply-by. The new date is whatever this mail states: an explicit registration
        // deadline if one parsed, else the single date it carries ("extended to 25 August").
        // Nothing else about the notice changes — only the deadline is applied at publish time.
        const newDeadline = fields.registration_deadline || fields.startDate || null;
        return [{
            mutation_type: 'PATCH_NOTICE', club: attr.club, attributionVia: attr.via,
            evidence: { lifecycle: lc.kind },
            payload: {
                ...fields, lifecycle: lc.kind,
                deadline: newDeadline,
                deadline_time: newDeadline ? (fields.deadline_time || null) : null,
            },
        }];
    }
    if (lc.type) {
        // A PATCH needs something to patch WITH. Phrase-matching alone cannot tell a stated change
        // ("postponed to 5 September", "venue changed to Mac Aud") from a PROMISED one ("the revised
        // date and time will be shared soon") — both trip lifecyclePatchCues, but the second carries
        // no value, and publishing it writes an empty update over a live event.
        //
        // Real example: CDC's "Interview Preparation Session – Postponement Notice" (11 Jul 2026)
        // matched on BOTH `postponement` and `revised (date|time)` while stating neither. So decide
        // on the extracted DATA, not the wording: a reschedule that produced no new date, time or
        // venue is an open-ended postponement, and the honest mutation is a cancel.
        // Restricted to lc.timeShift — the date/time-moving cues. A venue change is never downgraded:
        // venue extraction is much weaker than date extraction, so "no venue parsed" is far more often
        // an extractor miss than a genuinely open-ended move.
        const hasNewDetail = !!(fields.startDate || fields.endDate || fields.time
            || fields.time_start || fields.venue || fields.venue_text);
        const openEnded = lc.kind === 'postponed' || (lc.type === 'PATCH_EVENT' && lc.timeShift && !hasNewDetail);
        const type = openEnded ? 'CANCEL_EVENT' : lc.type;
        const kind = openEnded ? 'postponed' : lc.kind;

        // Every date/time the extractor found in an open-ended postponement belongs to the schedule
        // being CALLED OFF ("sessions scheduled for 29th and 30th August have been postponed").
        // Carrying those forward re-asserts the cancelled slot as the new one — the CDC mail yielded
        // startDate 2026-08-30, the very day that was called off. Blank them; the re-announcement
        // supplies real ones. A plain 'cancel' keeps its dates: naming the day being cancelled is
        // legitimate and helps the reviewer match the right event.
        const payload = kind === 'postponed'
            ? { ...fields, startDate: null, endDate: null, time: null, time_start: null, duration_minutes: null, lifecycle: kind }
            : { ...fields, lifecycle: kind };
        return [{
            mutation_type: type, club: attr.club, attributionVia: attr.via,
            evidence: { lifecycle: kind, ...(openEnded && lc.type === 'PATCH_EVENT' ? { downgraded_from: 'PATCH_EVENT', reason: 'no new date/time/venue stated' } : {}) },
            payload,
        }];
    }
    // A CLUB's OWN hackathon / competition / recruitment is something students turn up to on campus, so
    // it is an EVENT even though it also has an apply-by. The SAME club merely circulating somebody
    // else's national contest is passing on information — that stays an opportunity/notice. Requires a
    // resolved club (Institute-attributed mail is by definition not a club's own activity).
    // Only a REAL student club or fest gets the "its own activity is an event" treatment. An institute
    // office or programme (CDC, Fit India, Green Office, the student councils) sits in the same table
    // but is not a club: only a genuine dated event of theirs reaches the events feed, everything else
    // — their recruitment, circulars, programme announcements — stays a notice.
    const isInstituteEntity = !attr.club
        || CFG.instituteEntities.some((n) => n.toLowerCase() === String(attr.club).toLowerCase());
    const clubRun = !!attr.club && !isInstituteEntity;
    const ownBlob = `${stripSubject(email.subject)}\n${email.body_text || ''}`;
    // "organised/hosted by <X>" only means EXTERNAL when X is somebody else. Campus mail routinely says
    // "hosted by the SocBiz" or "organised by PAG" — the club naming itself. Neutralise the club's own
    // name (and its short form) before the external test so self-attribution can't read as outsourcing.
    const escape = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const selfNames = clubRun
        ? [attr.club, (/^([^(]+?)\s*\(/.exec(attr.club) || [])[1], (/\(([^)]+)\)/.exec(attr.club) || [])[1]].filter(Boolean)
        : [];
    // Scope the external test to the SUBJECT + the opening of the body, where campus mail states who is
    // running the thing. Scanning the whole body let a passing mention of ANOTHER event hijack it: the
    // Institute Sports Council's own on-campus triathlon was read as external purely because a later
    // line said winners go on to "the National Triathlon Championship, organized by the Triathlon
    // Federation of India" — a different competition entirely.
    const opening = `${stripSubject(email.subject)}\n${(email.body_text || '').slice(0, 400)}`;
    const extBlob = selfNames.reduce((t, n) => t.replace(new RegExp(escape(n.trim()), 'gi'), 'IIT Roorkee'), opening);
    // ...and if it plainly happens ON this campus, it is ours however national its title sounds.
    const onOurCampus = /\b(?:at|in|on)\s+IIT\s*Roorkee\b|\bIIT\s*Roorkee\s+campus\b|\bwithin\s+campus\b/i.test(opening);
    const ownActivity = clubRun
        && (CFG.recruitmentCues.test(ownBlob)
            || /hackathon|\bcompetition\b|\bcontest\b|championship|\bcup\b|ideathon|\bquiz\b/i.test(stripSubject(email.subject)))
        && (onOurCampus || !CFG.externalOrganiserCues.test(extBlob));
    // Applies to a club's own activity whichever side it landed on. Gating this on 'opportunity' alone
    // missed the ones whose wording dodged the deadline cues — "Pragyotsav 2026 | Sanskrit Club
    // Competition … Submit entries by 22 August" typed as a plain notice and never got promoted.
    // Safe to include 'notice': ownActivity still demands recruitment cues or a competition word in the
    // SUBJECT, so a club newsletter, recap or aftermovie cannot be swept up by this.
    if ((cls.type === 'opportunity' || cls.type === 'notice') && ownActivity) {
        return [{
            mutation_type: 'CREATE_EVENT',
            club: attr.club,
            attributionVia: attr.via,
            evidence: { club_own_activity: true },
            payload: { ...fields, categories: categoriesFor(categoryText(email, fields)) },
        }];
    }
    if (cls.type === 'event') {
        return [{
            mutation_type: 'CREATE_EVENT',
            club: attr.club,
            attributionVia: attr.via,
            payload: { ...fields, categories: categoriesFor(categoryText(email, fields)) },
        }];
    }
    // opportunity | notice → notice (deterministic; the runner's Groq-primary path re-decides type/kind)
    const noticeBlob = `${stripSubject(email.subject)}\n${email.body_text || ''}`;
    const kind = classifyNoticeKind(noticeBlob, { hasDeadline: cls.type === 'opportunity' });
    const applyBy = fields.registration_deadline
        || (STRONG_DEADLINE_CUE.test(noticeBlob) ? (fields.startDate || null) : null);
    const np = noticePayload(email, {
        isOpportunity: kind.opportunity,
        kindKey: kind.key,
        deadlineDate: applyBy,
        deadlineTime: fields.deadline_time,
        summary: fields.description,
        calendarEntries,
    });
    if (fields.startDate && fields.startDate !== applyBy) np.payload.event_date = fields.startDate;
    if (fields.time_start) np.payload.time_start = fields.time_start;
    if (fields.venue) np.payload.venue = fields.venue;
    if (fields.venue_mode) np.payload.venue_mode = fields.venue_mode;
    // attribute() already resolved the club — carry it. Dropping it here is what orphaned every club
    // recruitment / PoR / competition notice: no club_id meant global-admin review and no club page.
    return [{ mutation_type: 'CREATE_NOTICE', club: attr.club, attributionVia: attr.via, evidence: np.evidence, payload: np.payload }];
}

// Build the proposal for a Groq-decided type, reusing deterministic extraction + attribution. Privacy
// is NOT decided here — gate-denied mail never reaches this. Groq only picks the CATEGORY.
// Per-field GUARDED merge of Groq-extracted fields over the deterministic baseline. Monotonic: a Groq
// value only REPLACES the deterministic one when it (a) passed groq.js's format gate, (b) is corroborated
// by a matching token somewhere in the email (looksDate/TimeStr — blocks pure invention), and (c) for dates,
// lands in a plausibility window around the email's sent date (the year-hallucination guard). Pure: the
// window uses the email's sent date, never wall-clock. Returns merged payload + a per-field provenance map.
function mergeFields(det, llm, fullText, sentDate) {
    const p = { ...det };
    const source = {};
    if (!llm) { canonicaliseVenue(p); return { payload: p, fields_source: source }; }
    const dateOk = looksDateStr(fullText || '');
    const timeOk = looksTimeStr(fullText || '');
    const refISO = sentDate ? new Date(sentDate).toISOString().slice(0, 10) : null;
    // An event happens near its announcement. The forward edge used to be 400 days, which is wider than
    // anything real and let through the exact error it existed to catch: a bare "20th August" that has
    // already passed gets resolved to NEXT year, landing 365 days out — inside 400, so accepted.
    // Measured over a year of mail: only two legitimate dates sit more than 90 days ahead (+95d World
    // Landslide Forum, +151d Winter School) and NOTHING legitimate falls between 181 and 400 days.
    // 200 keeps both with room to spare and rejects a year-error. When rejected the model's date is
    // simply not taken, so the item keeps the deterministic date or none at all — a missing date is
    // recoverable in review, a confidently wrong one is not.
    const inWindow = (d) => {
        if (!refISO || !d) return true;
        const days = (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${refISO}T00:00:00Z`)) / 864e5;
        return days >= -30 && days <= 200;
    };
    if (llm.name) { const t = cleanTitle(llm.name); if (t && t.length >= 3) { p.title = t; source.title = 'llm'; } }
    if (llm.date && dateOk && inWindow(llm.date)) { p.startDate = llm.date; source.startDate = 'llm'; }
    if (llm.end_date && dateOk && inWindow(llm.end_date)) { p.endDate = llm.end_date; source.endDate = 'llm'; }
    if (llm.registration_deadline && dateOk && inWindow(llm.registration_deadline)) { p.registration_deadline = llm.registration_deadline; source.registration_deadline = 'llm'; }
    if (p.registration_deadline && p.registration_deadline === p.startDate) p.registration_deadline = null;   // collision rule
    if (llm.time && timeOk) { p.time_start = llm.time; source.time_start = 'llm'; if (llm.duration_minutes) p.duration_minutes = llm.duration_minutes; }
    // Deadline closing time — same corroboration rule as the start time: a clock time must actually
    // appear in the email, so the model cannot invent "23:59" for a mail that stated no time.
    if (llm.deadline_time && timeOk) { p.deadline_time = llm.deadline_time; source.deadline_time = 'llm'; }
    // CATEGORIES. The model reads the whole email and judges what the event IS; the keyword rules only
    // see which words appear, which is how a puppetry recital picked up "Sports & Fitness". LLM-primary,
    // regex fallback — matching every other field here. Already enum-gated in groq.js.
    if (Array.isArray(llm.categories) && llm.categories.length) { p.categories = llm.categories; source.categories = 'llm'; }
    // VENUE MODE. 'online' and 'tba' are mutually exclusive states, so the mode is taken as a unit and
    // the venue STRING is kept consistent with it — otherwise a merge could leave venue:"Online" sitting
    // on mode:'tba'. The deterministic detector wins on 'online' (it matches the actual platform tokens);
    // the model is only allowed to ADD 'tba', which is a phrasing judgement regex is weaker at.
    if (llm.venue_mode === 'tba' && p.venue_mode !== 'online' && !p.venue) {
        p.venue_mode = 'tba'; p.venue = null; source.venue_mode = 'llm';
    }
    if (llm.venue) {
        const v = llm.venue.replace(/[\s,;:\-–&]+$/, '').trim();
        // A model answering "TBA"/"to be announced" in the venue field is stating a MODE, not a place.
        const deferred = /^(tba|tbd|to be (announced|decided|confirmed)|not (yet )?(decided|announced)|will be (announced|communicated|shared))\.?$/i.test(v);
        if (deferred) {
            if (p.venue_mode !== 'online' && !p.venue) { p.venue_mode = 'tba'; source.venue_mode = 'llm'; }
        } else if (v) {
            p.venue = v; source.venue = 'llm';
            if (/^online$/i.test(v)) p.venue_mode = 'online';
            else if (p.venue_mode !== 'online') p.venue_mode = 'physical';
        }
    }
    if (llm.description) { p.description = llm.description; source.description = 'llm'; }
    // ONE SPELLING PER PLACE. Applied after the merge so it covers both paths — whichever of the regex
    // or the model won the venue, it lands in the same canonical form ("APJ-AKB 205" and "APJ–205" are
    // the same room and must not become two venues). If nothing usable survives — off campus, or a
    // non-answer like "IIT Roorkee" / "will be shared shortly" — the NAME is dropped but the fact that
    // a physical event exists is not: the mode falls back to 'tba', which is exactly that state.
    canonicaliseVenue(p);
    // Corroborated free-text / URL fields. A URL must literally appear in the email — the model will
    // otherwise reconstruct a plausible-looking form link. Free text is trusted (format-gated upstream)
    // but only FILLS a blank, so a regex hit is never overwritten by a looser LLM paraphrase.
    const inText = (v) => !!v && String(fullText || '').includes(v);
    if (llm.meeting_link && inText(llm.meeting_link)) { p.meeting_link = llm.meeting_link; source.meeting_link = 'llm'; }
    if (llm.registration_link && inText(llm.registration_link)) { p.registration_link = llm.registration_link; source.registration_link = 'llm'; }
    if (llm.speaker && !p.speaker) { p.speaker = llm.speaker; source.speaker = 'llm'; }
    if (llm.eligibility && !p.eligibility) { p.eligibility = llm.eligibility; source.eligibility = 'llm'; }
    if (llm.action) { p.action = llm.action; source.action = 'llm'; }
    return { payload: p, fields_source: source };
}

// calendarEntries is threaded all the way down here on purpose. This is the GROQ-PRIMARY path — the
// one that runs whenever the LLM reclassifies an email — and it builds its notice payload through
// noticePayload(), which needs the calendar to fill a missing deadline. Omitting the parameter while
// the body referenced it threw "calendarEntries is not defined" on every LLM-reclassified message.
function proposalForType(email, type, kindKey, senderMap, llmFields, clubIndex, calendarEntries = null) {
    const det = extract(email);
    const { payload: fields, fields_source } = mergeFields(det, llmFields, `${email.subject || ''}\n${email.body_text || ''}`, email.internal_date);
    if (type === 'dismiss') return { mutation_type: 'DISMISS', reason: 'llm_dismiss' };
    if (type === 'calendar') {
        const blob = `${email.subject || ''}\n${email.body_text || ''}`.toLowerCase();
        const calKind = CFG.calendarHolidayCues.test(blob) ? 'holiday' : 'working';
        return { mutation_type: 'CALENDAR_ENTRY', payload: { ...fields, cal_kind: calKind }, _fields_source: fields_source };
    }
    if (type === 'event') {
        const attr = attribute(email, senderMap, clubIndex);
        return {
            mutation_type: 'CREATE_EVENT', club: attr.club, attributionVia: attr.via,
            payload: {
                ...fields,
                categories: (fields.categories && fields.categories.length)
                    ? fields.categories                                    // LLM-decided
                    : categoriesFor(categoryText(email, fields)),          // fallback: keyword rules
            }, _fields_source: fields_source,
        };
    }
    // opportunity | notice — use the merged (clean) title/description/deadline
    const isOpportunity = type === 'opportunity';
    const validKinds = new Set(CFG.noticeKinds.map((k) => k.key).concat(['deadline', 'notice']));
    const key = validKinds.has(kindKey) ? kindKey : (isOpportunity ? 'deadline' : 'notice');
    const blob = `${stripSubject(email.subject)}\n${email.body_text || ''}`;
    // "deadline" means APPLY-BY and drives expiry, so an explicit registration deadline wins. A bare
    // startDate is only an apply-by when the mail is actually deadline-shaped; being an "opportunity" is
    // NOT enough — ICPC's "Prelims are scheduled on 3rd October" is when it HAPPENS, and calling that a
    // deadline both mislabels it and expires the notice early. Otherwise the date belongs in event_date.
    const applyBy = fields.registration_deadline
        || (STRONG_DEADLINE_CUE.test(blob) ? (fields.startDate || null) : null);
    const np = noticePayload(email, {
        isOpportunity, kindKey: key, deadlineDate: applyBy, deadlineTime: fields.deadline_time,
        summary: fields.description, action: fields.action, calendarEntries,
    });
    if (fields_source.title) np.payload.title = fields.title;
    if (fields.startDate && fields.startDate !== applyBy) np.payload.event_date = fields.startDate;
    if (fields.time_start) np.payload.time_start = fields.time_start;
    if (fields.venue) np.payload.venue = fields.venue;
    if (fields.venue_mode) np.payload.venue_mode = fields.venue_mode;
    // same attribution as the event path — a notice from a club belongs to that club (see runPipeline)
    const nAttr = attribute(email, senderMap, clubIndex);
    return {
        mutation_type: 'CREATE_NOTICE', club: nAttr.club, attributionVia: nAttr.via,
        evidence: np.evidence, payload: np.payload, _fields_source: fields_source,
    };
}

module.exports = {
    runPipeline, passesGates, classify, classifyNoticeKind, detectLifecycle, addsSchedule, carryForward, extract, attribute, senderVerified, parseDates, relativeDate, yearlessDate, stripQuotedHeaders, speakerOf, clubFromSubject, clubFromSignOff, clubInText, clubOrganiserInBody, stripSubject, topMessage, cleanBody, deriveDescription, noticeBody, categoriesFor, categoryText, addr, noticePayload, isImportantNotice, isExternalNotice, addrList, proposalForType, mergeFields, RULE_VERSION,
};
