/**
 * Ingestion runner: pull new mail from Gmail → persist raw (Inbox-Replay) → run the
 * deterministic pipeline → write typed CHANGE-PROPOSALS (event_proposal). Publishing a
 * proposal into a real event/notice is a separate admin action (Phase 4).
 *
 * Idempotent (skips already-ingested message_ids). Incremental via a stored Gmail
 * historyId cursor; first run backfills recent mail. No-ops if Gmail isn't configured.
 */
const CFG = require('./institutions/iitr.config');
const gmail = require('./source/gmail');
const groq = require('./review/groq');
const gemini = require('./review/gemini');
const logger = require('../../utils/logger');
const sentry = require('../../utils/sentry');
const s3 = require('../../utils/s3');
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { runPipeline, passesGates, proposalForType, mergeFields, senderVerified, stripSubject, detectLifecycle, addsSchedule, carryForward, topMessage, parseDates, RULE_VERSION } = require('./index');
const {
    IngestedEmail, EventProposal, SenderEntityMap, Club, IngestionState, ClassificationOverride,
} = require('../../database/schemas');

// Content de-dup signature: the same announcement arrives as separate messages via ug@/pg@/
// students-notices@, plus Fwd:/reminder copies. Message-id dedup misses those; this normalized-
// subject key catches them. Null for too-generic subjects (would over-merge unrelated notices).
const GENERIC_SUBJ = /^(notice|circular|information|invitation|important|update|reminder)s?$/i;
// Campus senders bury the Re:/Fwd: MID-subject and prepend their own words:
//   "CLARIFICATION--Re: LINK for QUIZ-----Re: QUIZ based on the National Building Code"
// stripSubject only removes a LEADING prefix, so every one of those read as a brand-new email and the
// same quiz was created four times, in three different sections. Cut repeatedly up to the LAST Re:/Fwd:
// and what remains is the original subject the whole chain hangs off.
function conversationKey(subject) {
    let t = stripSubject(subject || '');
    for (let i = 0; i < 6 && /\b(?:re|fwd|fw)\s*:/i.test(t); i++) t = t.replace(/^.*?\b(?:re|fwd|fw)\s*:\s*/i, '');
    return t.toLowerCase().replace(/\s+/g, ' ').trim();
}
function dedupKey(email) {
    const s = conversationKey(email.subject);
    if (s.length < 12 || GENERIC_SUBJ.test(s)) return null;
    return s.slice(0, 200);
}

// proposal mutation → coarse category, for dual-verdict logging (LLM vs deterministic agreement).
function typeOf(p) {
    if (p.mutation_type === 'CREATE_EVENT') return 'event';
    if (p.mutation_type === 'CALENDAR_ENTRY') return 'calendar';
    if (p.mutation_type === 'DISMISS') return 'dismiss';
    if (p.mutation_type === 'PATCH_NOTICE') return 'patch_notice';
    return p.payload && p.payload.is_opportunity ? 'opportunity' : 'notice';
}

async function loadSenderMap() {
    const rows = await SenderEntityMap.findAll({ include: [{ model: Club, attributes: ['name'] }] });
    const map = {};
    for (const r of rows) if (r.Club) map[r.match_value] = r.Club.name;
    return map;
}

// Alias index for relay attribution: every club name, plus the two halves of a
// "SHORT(Long Form)" name, plus the IITR-suffix-stripped variant. Longest first so
// "Cinema Club" wins over "Cinema". Normalised the same way clubFromSubject normalises.
// The parsed academic calendar, for notices that state no date and point at it instead. Loaded once
// per run alongside the club index — the pipeline stays pure and is handed the data it needs.
async function loadCalendarEntries() {
    const { AcademicCalendarEntry } = require('../../database/schemas');
    return AcademicCalendarEntry.findAll({ attributes: ['semester', 'title', 'start_date'], raw: true });
}

async function loadClubIndex() {
    const clubs = await Club.findAll({ attributes: ['name', 'email'], raw: true });
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9& ]/g, ' ').replace(/\s+/g, ' ').trim();
    // squashed = no spaces, no punctuation, no trailing IITR. Lets "InfoSecIITR" match "InfoSec" and
    // "Student Technical Council" match "Students’ Technical Council" — clubs are not consistent.
    const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/iitr?$/, '');
    const aliases = [];
    const byEmail = new Map();       // the club's own address -> club. Exact, no text needed.
    const bySquash = new Map();
    for (const { name, email } of clubs) {
        const al = new Set([name]);
        const m = /^([^(]+?)\s*\(([^)]+)\)\s*$/.exec(name);
        if (m) { al.add(m[1].trim()); al.add(m[2].trim()); }
        for (const a of [...al]) al.add(a.replace(/\s*IITR?$/i, '').trim());
        for (const a of (CFG.clubAliases || {})[name] || []) al.add(a);
        for (const a of al) {
            const n = norm(a);
            if (n.length >= 3) aliases.push([n, name]);
            const sq = squash(a);
            if (sq.length >= 3 && !bySquash.has(sq)) bySquash.set(sq, name);
        }
        const addr = String(email || '').toLowerCase().trim();
        // A relay address must never identify a club: gensec.cult@ is stored as Cultural Council but
        // forwards for every cultural club.
        if (addr && !CFG.relaySenders.includes(addr)) byEmail.set(addr, name);
    }
    aliases.sort((a, b) => b[0].length - a[0].length);
    return { aliases, byEmail, bySquash };
}

const emailAddr = (f) => { const m = (f || '').match(/<([^>]+)>/); return (m ? m[1] : f || '').toLowerCase().trim(); };

async function loadOverrides() {
    try { return await ClassificationOverride.findAll({ raw: true }); }
    catch { return []; }   // table not yet created → no overrides
}

// Best-matching override for an email: same sender AND (no pattern | subject contains pattern).
// Most specific wins — a pattern rule beats a sender-only rule; among patterns, the longest.
function matchOverride(email, overrides) {
    if (!overrides || !overrides.length) return null;
    const from = emailAddr(email.from);
    const subj = (email.subject || '').toLowerCase();
    const hits = overrides.filter((o) => o.sender_addr === from
        && (!o.subject_pattern || subj.includes(o.subject_pattern.toLowerCase())));
    if (!hits.length) return null;
    hits.sort((a, b) => (b.subject_pattern || '').length - (a.subject_pattern || '').length);
    return hits[0];
}

// LLM-PRIMARY classification (Fable-ruled). Groq decides the CATEGORY of every gate-passing proposal;
// the deterministic pipeline result (`proposals`) is the FALLBACK when Groq is null/invalid — never a
// default category. Privacy is NOT decided here (gate-denied mail never reaches this). Always stamps
// provenance + a dual verdict {deterministic_type, llm_type, agreed} so disagreement rate = drift alarm.
// NB clubIndex: proposalForType re-runs attribution, and without the roster `clubFromSubject` can never
// match — so every relay-sender item (gensec.technical "PAG | …", gensec.cult "… | Finance Club") lost
// its club on the LLM path, which is the path that actually runs. It was only ever passed on the
// deterministic path, so relay attribution appeared to work in tests and silently failed in production.
async function reviewProposals(email, proposals, senderMap, out = {}, overrides = null, clubIndex = null, calendarEntries = null) {
    for (let i = 0; i < proposals.length; i++) {
        const det = proposals[i];
        // DISMISS + CANCEL need no field extraction. A PATCH (reschedule) DOES — it falls through to
        // Groq for FIELDS ONLY (keeps its lifecycle type; the returned type is ignored).
        if (det.mutation_type === 'DISMISS' || det.mutation_type === 'CANCEL_EVENT') continue;
        // A PATCH keeps its lifecycle type through the LLM pass and takes FIELDS ONLY — for a deadline
        // extension that is exactly what we want it to normalize (the new date, and a closing time).
        const isPatch = det.mutation_type === 'PATCH_EVENT' || det.mutation_type === 'PATCH_NOTICE';
        const detType = typeOf(det);
        const base = { ...(det.evidence || {}), deterministic_type: detType, rule_version: RULE_VERSION };

        // SUPER-ADMIN OVERRIDE — a scoped (sender[+pattern]) rule wins over BOTH Groq and the fallback.
        // It's a TYPE rule, so it does NOT apply to a lifecycle PATCH (which keeps its type).
        if (!isPatch) {
            const ov = matchOverride(email, overrides);
            if (ov) {
                const forced = proposalForType(email, ov.target_type, (det.payload && det.payload.kind) || null, senderMap, null, clubIndex, calendarEntries);
                forced.evidence = { ...base, source: 'override', override_id: ov.id, override_type: ov.target_type };
                proposals[i] = forced;
                out.overridden = (out.overridden || 0) + 1;
                ClassificationOverride.update({ hit_count: (ov.hit_count || 0) + 1, last_hit_at: new Date() }, { where: { id: ov.id } }).catch(() => {});
                continue;                                        // skip Groq for this item
            }
        }

        if (!groq.isConfigured()) { proposals[i] = { ...det, evidence: { ...base, source: 'deterministic_fallback' } }; continue; }

        out.reviewed = (out.reviewed || 0) + 1;
        // Groq now returns the TYPE and normalized FIELDS in one call; feed it the dethreaded body + sent date.
        const g = await groq.classifyEmail({ subject: (det.payload && det.payload.title) || email.subject, text: topMessage(email.body_text), sender: email.from, sentDate: email.internal_date });
        if (!g) {                                               // #1 safeguard: null → deterministic, FLAGGED, no default
            proposals[i] = { ...det, evidence: { ...base, source: 'deterministic_fallback', llm_error: true } };
            out.llm_fallback = (out.llm_fallback || 0) + 1;
            continue;
        }
        if (isPatch) {
            // reschedule: keep the PATCH_EVENT type, take ONLY Groq's normalized date/time/venue (guarded merge).
            const merged = mergeFields(det.payload, g.fields, `${email.subject || ''}\n${email.body_text || ''}`, email.internal_date);
            // A deadline extension's whole point is the NEW date, so recompute it from the merged
            // fields — otherwise a date Groq normalized better than the regex would be ignored.
            if (det.mutation_type === 'PATCH_NOTICE') {
                const d = merged.payload.registration_deadline || merged.payload.startDate || null;
                merged.payload.deadline = d;
                merged.payload.deadline_time = d ? (merged.payload.deadline_time || null) : null;
            }
            proposals[i] = { ...det, payload: merged.payload, evidence: { ...base, source: 'llm_fields', model_id: groq.MODEL, fields_source: merged.fields_source } };
            continue;
        }
        const final = proposalForType(email, g.type, g.kind, senderMap, g.fields, clubIndex, calendarEntries);   // Groq category + guarded-merged fields
        const agreed = detType === g.type;
        final.evidence = {
            ...(det.evidence || {}), ...(final.evidence || {}),            // keep reason_codes from both
            source: 'llm', model_id: groq.MODEL, rule_version: RULE_VERSION,
            groq: { type: g.type, kind: g.kind, confidence: g.confidence, reason: g.reason },
            deterministic_type: detType, llm_type: g.type, agreed,
            fields_source: final._fields_source || {},                    // which fields came from Groq vs regex
            ...(typeof g.confidence === 'number' && g.confidence < 0.6 ? { low_confidence: true } : {}),
        };
        proposals[i] = final;
        if (!agreed) { out.reclassified = (out.reclassified || 0) + 1; final._reclassified = true; }
    }
    return proposals;
}

const getCursor = async () => (await IngestionState.findByPk('gmail_history_id'))?.value || null;
const setState = (key, value) => IngestionState.upsert({ key, value: String(value), updated_at: new Date() });

// Metadata-only record for anything we refuse to process — NB: body_text is deliberately NULL so a
// personal / non-broadcast / sensitive email is never persisted, only that we saw & dropped it.
const recordDropped = (email, state, reason) => IngestedEmail.create({
    message_id: email.message_id,
    thread_id: email.thread_id,
    internal_date: email.internal_date,
    from_addr: email.from,
    to_addrs: email.to,
    subject: email.subject,
    body_text: null,
    raw_snapshot: { gmail_id: email.gmail_id },
    state,
    error: reason,
});

// Resolve a proposal's attributed club NAME → club_id, so the review queue can route it to that club's
// admins. Memoized (club names are stable). Unknown/absent name → Institute's id, which only global admins
// review. Found names are cached; unknown names are NOT (a club may be created later).
const _clubIdCache = new Map();
async function clubIdForProposal(p) {
    const name = ((p && p.club) || 'Institute').trim() || 'Institute';
    if (_clubIdCache.has(name)) return _clubIdCache.get(name);
    const row = await Club.findOne({ where: { name } });
    if (row) { _clubIdCache.set(name, row.id); return row.id; }
    const inst = _clubIdCache.get('Institute') || (await Club.findOne({ where: { name: 'Institute' } }))?.id || null;
    if (inst) _clubIdCache.set('Institute', inst);
    return inst;
}

const POSTER_DIR = path.join(__dirname, '../../uploads/posters');
const POSTER_BASE = process.env.INGEST_PUBLIC_BASE || 'http://127.0.0.1:8081';
const EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

// Download the poster ONLY for a CLUB event (never Institute/personal — personal mail was already
// gate-dropped before we reach here). Skips tiny images (signature logos). Sets payload.poster_url.
/**
 * Read the attached poster, and put what it says back into the EMAIL TEXT.
 *
 * THE BUG THIS FIXES, because it is worth stating exactly. Offices send "please find attached
 * invitation" with the date, time and venue only on the poster. The old rule opened the poster only
 * for a proposal that was already CREATE_EVENT and already attributed to a club — which produced a
 * catch-22: the poster was not read because the mail looked empty, and the mail looked empty because
 * the poster was not read. The classifier then discarded a real event on the strength of a covering
 * note. A Janmashtami invitation from the Institute Computer Centre was lost exactly this way.
 *
 * So the trigger is now the GAP, not the category: if an image is attached and the text is missing a
 * date or a venue, the poster is read. Institute mail included — offices are precisely the senders
 * who work this way.
 *
 * What comes back is appended to the body rather than written into one chosen proposal. That single
 * decision is what makes the fix work end to end: the pipeline re-runs over the enriched text, so the
 * deterministic extractor, the club attribution and the LLM classifier ALL see the poster's date and
 * venue. An item that looked like an empty notice can therefore become the event it always was —
 * which no amount of patching a payload after the fact would achieve, since the classifier had
 * already made its call on the thin text.
 */
async function readPoster(fullMsg, email, proposals) {
    const att = gmail.findImageAttachment(fullMsg.payload);
    // skip: no image · too small to be a poster (a signature logo) · larger than Gmail would deliver
    if (!att || (att.size && (att.size < 20000 || att.size > 25_000_000))) return null;

    // Spend a vision call only when the text actually lacks something. A mail that already states its
    // date and venue gains nothing from reading the picture, and this runs on every ingested message.
    const gap = !proposals.length || proposals.some((p) => {
        const pl = p.payload || {};
        return !pl.startDate || !(pl.venue && String(pl.venue).trim());
    });
    if (!gap) return null;

    const buf = await gmail.getAttachment(email.gmail_id, att.attachmentId);
    if (!buf) return null;

    const facts = {};
    // FREE first: many posters carry the date in the filename ("Guest Lecture April 29, 2026 ….jpg").
    if (att.filename) {
        const d = parseDates(att.filename.replace(/[._-]+/g, ' ')).startDate;
        if (d && inSentWindow(d, email.internal_date)) facts.date = d;
    }
    if (gemini.isConfigured()) {
        const g = await gemini.extractFromPoster(buf, att.mimeType, { subject: email.subject, sentDate: email.internal_date });
        if (g) {
            // inSentWindow guards against a poster's "see you next year" or a misread year putting an
            // event somewhere absurd relative to when the mail was actually sent.
            if (!facts.date && g.date && inSentWindow(g.date, email.internal_date)) facts.date = g.date;
            if (g.end_date && inSentWindow(g.end_date, email.internal_date)) facts.end_date = g.end_date;
            if (g.time) facts.time = g.time;
            if (g.venue) facts.venue = g.venue;
        }
    }
    return Object.keys(facts).length ? { att, buf, facts } : { att, buf, facts: null };
}

/**
 * Render poster facts as plain lines the extractor already knows how to read.
 *
 * Deliberately phrased the way a human would write it ("Date: 5 September 2026"), because every
 * downstream date/venue parser is tuned to ordinary email prose. Inventing a machine format here
 * would mean teaching all of them a second dialect.
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * ISO in, prose out — and this is load-bearing, not cosmetic.
 *
 * The vision model returns `2026-09-05`, and the date extractor does NOT read that: it is tuned to
 * how people write dates in email. Injecting the raw ISO string produced a block that looked correct,
 * parsed to nothing, and left the mail exactly as empty as before the poster was read.
 */
const asProse = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');                      // already prose, or unparseable — pass through
    return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
};

function posterBlock(facts) {
    const lines = [];
    if (facts.date) lines.push(`Date: ${asProse(facts.date)}${facts.end_date && facts.end_date !== facts.date ? ` to ${asProse(facts.end_date)}` : ''}`);
    if (facts.time) lines.push(`Time: ${facts.time}`);
    if (facts.venue) lines.push(`Venue: ${facts.venue}`);
    return lines.length ? `[From the attached poster]\n${lines.join('\n')}` : null;
}

/**
 * Store the poster image itself, so the published item can show it.
 *
 * Runs AFTER classification, unlike the extraction above, because only then is the final type known —
 * and no longer refuses Institute events, which was the other half of the old rule. Best-effort: a
 * failed upload must never cost the proposal.
 */
async function storePoster(proposals, poster, email) {
    const ev = proposals.find((p) => p.mutation_type === 'CREATE_EVENT');
    if (!ev || !poster || ev.payload?.poster_url) return;
    try {
        const file = `${email.gmail_id}.${EXT[poster.att.mimeType] || 'jpg'}`;
        // Prefer S3 (durable, CloudFront-served, survives container redeploys). Local disk is the dev
        // fallback only — on an ephemeral container that copy is lost on the next redeploy.
        const s3url = await s3.uploadPoster(`posters/${file}`, poster.buf, poster.att.mimeType);
        if (s3url) {
            ev.payload = { ...ev.payload, poster_url: s3url };
        } else {
            fs.mkdirSync(POSTER_DIR, { recursive: true });
            fs.writeFileSync(path.join(POSTER_DIR, file), poster.buf);
            ev.payload = { ...ev.payload, poster_url: `${POSTER_BASE}/uploads/posters/${file}` };
        }
    } catch (e) { logger.error({ err: e }, 'poster upload failed'); }
}

function inSentWindow(iso, sentDate) {
    if (!sentDate || !iso) return true;
    const days = (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${new Date(sentDate).toISOString().slice(0, 10)}T00:00:00Z`)) / 864e5;
    return days >= -30 && days <= 400;
}

async function processMessage(gmailId, senderMap, out, overrides = null, clubIndex = null, calendarEntries = null) {
    const full = await gmail.getMessage(gmailId);
    const email = gmail.normalizeMessage(full);
    if (await IngestedEmail.findOne({ where: { message_id: email.message_id } })) { out.skipped++; return; }

    // PRIVACY-FIRST: gate BEFORE storing any body. Non-broadcast (personal) / off-domain / sensitive
    // mail is dropped here with body_text=null — it never lands in the DB or a proposal.
    const gate = passesGates(email);
    if (!gate.ok) { await recordDropped(email, 'dismissed', gate.reason); out.dismissed++; return; }

    // Groq privacy screen (drop-only backstop for personal data that slipped past the regex wall).
    if (groq.isConfigured()) {
        const scr = await groq.screenPrivacy({ subject: email.subject, text: email.body_text });
        if (scr && scr.personal) {
            await recordDropped(email, 'dismissed', `privacy:${scr.reason}`);
            out.dismissed++; out.privacy_dropped = (out.privacy_dropped || 0) + 1;
            return;
        }
    }

    // Find a prior copy (same normalized subject, ≤21 days). A plain repeat/reminder → DEDUP (no second
    // proposal). A cancel/reschedule (lifecycle) is NOT a dup — it goes through and gets LINKED to the prior.
    const key = dedupKey(email);
    const lc = detectLifecycle(email);
    let prior = null;
    if (key) {
        const since = new Date(Date.now() - 21 * 864e5);
        // SAME SENDER only (plus the configured co-sender pairs, which deliberately broadcast the same
        // item). Matching on subject alone across senders could merge two offices' similarly-titled
        // mail — and the looser conversation key above makes that likelier, so tighten it here.
        const self = emailAddr(email.from);
        const partners = (require('./institutions/iitr.config').coSenderGroups || [])
            .filter((g) => g.includes(self)).flat();
        const senders = [...new Set([self, ...partners])];
        prior = await IngestedEmail.findOne({
            where: {
                dedup_key: key,
                state: { [Op.ne]: 'duplicate' },
                internal_date: { [Op.gte]: since },
                from_addr: { [Op.or]: senders.map((a) => ({ [Op.iLike]: `%${a}%` })) },
            },
            order: [['internal_date', 'DESC']],
        });
    }
    // A same-subject follow-up is only a DUPLICATE when it says nothing new. One that fills in a date,
    // time or venue the original never stated is the announcement students are actually waiting for —
    // dropping it silently lost the whole schedule and left a date-less item on the feed.
    const scheduleAdds = prior && !lc.type ? addsSchedule(prior, email) : null;
    // did the follow-up CHANGE a detail rather than merely supply a missing one?
    const changedExisting = !!(scheduleAdds && scheduleAdds.some((k) => k.endsWith('_changed')));
    if (prior && !lc.type && !scheduleAdds) {
        await IngestedEmail.create({
            message_id: email.message_id, thread_id: email.thread_id, internal_date: email.internal_date,
            from_addr: email.from, to_addrs: email.to, subject: email.subject, body_text: null,
            raw_snapshot: { gmail_id: email.gmail_id, dup_of: prior.id }, state: 'duplicate', dedup_key: key,
        });
        out.duplicates = (out.duplicates || 0) + 1;
        return;
    }

    const ing = await IngestedEmail.create({
        message_id: email.message_id,
        thread_id: email.thread_id,
        internal_date: email.internal_date,
        from_addr: email.from,
        to_addrs: email.to,
        subject: email.subject,
        body_text: email.body_text,
        raw_snapshot: { gmail_id: email.gmail_id, ...((lc.type || scheduleAdds) && prior ? { supersedes: prior.id } : {}) },
        dedup_key: key,
        state: 'parsed',
    });

    let proposals;
    try { proposals = runPipeline(email, { senderMap, clubIndex, calendarEntries }); }
    catch (e) { await ing.update({ state: 'error', error: e.message }); out.errors++; return; }

    // ── The poster ───────────────────────────────────────────────────────────
    // Read BEFORE classification, because what it says decides what this mail even is. The facts are
    // appended to the body and the pipeline re-runs, so the extractor, the attribution and the LLM all
    // judge the mail on its real contents rather than on a covering note. Best-effort throughout: a
    // failure here leaves the original proposals exactly as they were.
    let poster = null;
    let posterFields = null;
    try {
        poster = await readPoster(full, email, proposals);
        const block = poster && poster.facts ? posterBlock(poster.facts) : null;
        if (block) {
            // topMessage() first: it is applied again downstream, and appending past a quoted reply
            // would put the poster's facts exactly where that trim discards them.
            email.body_text = `${topMessage(email.body_text)}\n\n${block}`;
            proposals = runPipeline(email, { senderMap, clubIndex, calendarEntries });
            posterFields = Object.keys(poster.facts).map((k) => `vision:${k}`);
            out.poster_reads = (out.poster_reads || 0) + 1;
        }
    } catch (e) { logger.error({ err: e }, 'poster read failed'); }

    await reviewProposals(email, proposals, senderMap, out, overrides, clubIndex, calendarEntries);
    if (poster) await storePoster(proposals, poster, email);   // image for the published card
    if (posterFields) for (const p of proposals) p.evidence = { ...(p.evidence || {}), poster_fields: posterFields };

    // The schedule-announcement follow-up REPLACES the thinner original rather than sitting next to it.
    // Which action that needs depends on how far the original got:
    //   · still awaiting review  → retire it, so the admin sees ONE card (the complete one), not two.
    //   · already published as an event → turn this into a PATCH so the live event gains the date/time/
    //     venue in place, instead of a duplicate event appearing on the feed.
    //   · already published as a notice → leave it as a fresh proposal and say so in the evidence; the
    //     item is changing type (date-less notice → real event), which is the admin's call, not ours.
    if (scheduleAdds && prior) {
        const priorProp = await EventProposal.findOne({ where: { ingested_email_id: prior.id }, order: [['id', 'DESC']] });
        if (priorProp && priorProp.state === 'proposed') {
            await priorProp.update({
                state: 'dismissed',
                evidence: {
                    ...(priorProp.evidence || {}),
                    superseded_by_message_id: email.message_id,
                    superseded_reason: `schedule announced (${scheduleAdds.join(', ')})`,
                },
            });
            out.superseded = (out.superseded || 0) + 1;
        } else if (changedExisting && priorProp && priorProp.state === 'proposed') {
            // A CHANGED date/time/venue on an item still awaiting review: keep the newer one (it has
            // the current details) and retire the stale proposal, same as a filled-in blank.
            await priorProp.update({
                state: 'dismissed',
                evidence: { ...(priorProp.evidence || {}), superseded_by_message_id: email.message_id, superseded_reason: `details changed (${scheduleAdds.join(', ')})` },
            });
            out.superseded = (out.superseded || 0) + 1;
        } else if (priorProp && priorProp.state === 'published' && priorProp.mutation_type === 'CREATE_EVENT') {
            for (let i = 0; i < proposals.length; i++) {
                const p = proposals[i];
                if (p.mutation_type !== 'CREATE_EVENT' && p.mutation_type !== 'CREATE_NOTICE') continue;
                // A blank being FILLED is a late announcement (nothing moved). A value that CHANGED is a
                // real reschedule and must show as one, so the event carries the "Rescheduled" badge.
                const kind = changedExisting ? 'reschedule' : 'schedule_announced';
                proposals[i] = {
                    ...p,
                    mutation_type: 'PATCH_EVENT',
                    evidence: { ...(p.evidence || {}), lifecycle: kind, schedule_added: scheduleAdds },
                    payload: { ...p.payload, lifecycle: kind },
                };
            }
        }
        // The follow-up is usually three lines of logistics. Pull the description, link, speaker and
        // anything else it did NOT state from the original message of the same conversation, so the
        // published item has substance and not just a date. Additive only — never overwrites.
        for (const p of proposals) {
            if (p.payload) p.payload = carryForward(p.payload, prior);
            p.evidence = {
                ...(p.evidence || {}),
                schedule_added: scheduleAdds,
                ...(p.payload && p.payload._carried_from_original ? { carried_from_original: p.payload._carried_from_original } : {}),
            };
        }
        out.schedule_updates = (out.schedule_updates || 0) + 1;
    }

    // Nothing produced at all? Say so on the row. A mail that reaches `parsed` and yields no proposal
    // used to be indistinguishable from a crash — both left `state='parsed'` and silence — so "why did
    // today's event not appear?" could only be answered by reading code and guessing. The classifier
    // discarding something is a DECISION and deserves a record; three of 187 messages were in this
    // state and one of them was a real event.
    const dropped = proposals.filter((p) => p.mutation_type === 'DISMISS');
    if (proposals.length && dropped.length === proposals.length) {
        await ing.update({
            state: 'parsed',
            error: `discarded: ${dropped.map((p) => p.reason || 'unknown').join(', ')}`,
        }).catch(() => {});
    }

    for (const p of proposals) {
        if (p.mutation_type === 'DISMISS') { out.dismissed++; continue; }
        // link a cancel/reschedule/schedule-fill to the item it supersedes so the reviewer applies it.
        if ((lc.type || scheduleAdds) && prior) p.payload = { ...p.payload, _supersedes_message_id: prior.message_id };
        await EventProposal.create({
            ingested_email_id: ing.id,
            mutation_type: p.mutation_type,
            club_id: await clubIdForProposal(p),   // attributed club → routes the review to that club's admins
            target_event_id: null,   // resolved at publish time from _supersedes_message_id
            payload: { ...p.payload, club: p.club || null, _from: email.from, _message_id: email.message_id },
            evidence: { ...(p.evidence || {}), rule_version: RULE_VERSION, reclassified: !!p._reclassified, unverified_sender: !senderVerified(email, senderMap) },
            state: 'proposed',
        });
        out.proposals++;
        if (p.mutation_type === 'CREATE_EVENT') out.events++;
        else if (p.mutation_type === 'CREATE_NOTICE') out.notices++;
        else if (p.mutation_type === 'CALENDAR_ENTRY') out.calendar++;
        else if (['CANCEL_EVENT', 'PATCH_EVENT', 'PATCH_NOTICE'].includes(p.mutation_type)) out.lifecycle = (out.lifecycle || 0) + 1;
    }
}

let ingestRunning = false;   // module-level lock: never let poll + manual /run overlap (resource safety)
async function runIngest({ backfillDays = 30 } = {}) {
    if (!gmail.isConfigured()) return { disabled: true };
    if (ingestRunning) return { busy: true };   // a run is already in flight — skip, don't stack
    ingestRunning = true;
    try {
    const query = `${process.env.INGEST_QUERY || 'to:students-notices@iitr.ac.in'} newer_than:${backfillDays}d`;
    const senderMap = await loadSenderMap();
    const clubIndex = await loadClubIndex();
    const calendarEntries = await loadCalendarEntries();
    const overrides = await loadOverrides();   // super-admin classification rules, loaded once per run
    const out = { events: 0, notices: 0, calendar: 0, dismissed: 0, proposals: 0, skipped: 0, errors: 0 };

    const cursor = await getCursor();
    let ids = [];
    // The point history was actually enumerated UP TO. The cursor must advance to here and no further
    // — see the setState at the end of this function for the race this closes.
    let enumeratedTo = null;
    try {
        if (!cursor) {
            ids = await gmail.listMessageIds({ query, max: 120 });        // first run → backfill
        } else {
            const h = await gmail.listHistory(cursor);
            ids = h.expired ? await gmail.listMessageIds({ query, max: 120 }) : h.ids;  // stale cursor → re-backfill
            if (!h.expired) enumeratedTo = h.historyId;
        }
    } catch (e) {
        // An expired/revoked refresh token would otherwise stop ingestion SILENTLY. Record it so
        // /status shows the failure instead of the feed just going stale with no signal.
        if (gmail.isAuthError(e)) {
            console.error('🔴 Gmail AUTH FAILED — ingestion stopped. Refresh token likely expired/revoked (set the OAuth consent screen to "In production").');
            await setState('auth_status', JSON.stringify({ ok: false, error: e.message, at: new Date().toISOString() }));
            return { authFailed: true, error: e.message };
        }
        throw e;
    }
    await setState('auth_status', JSON.stringify({ ok: true, at: new Date().toISOString() }));

    // Pace a BULK backfill so it doesn't burst past Groq's 12k-tokens/minute cap (each field-extraction
    // call is ~1k tokens). Steady-state polls (a few emails) skip this; only large runs are throttled.
    // Pacing is per-MODEL, not a constant. 4.5s was right for llama-3.3-70b (12k tokens/min, ~2k a
    // call). gpt-oss-120b allows 8k/min and costs ~2.5k a call — ~3/min, i.e. one every 20s. Running
    // faster does not fail loudly: every call 429s, the retries burn, and the whole backfill silently
    // classifies with the regex instead. Env-tunable so a model change does not require a code change.
    // OLDEST FIRST. Gmail lists newest-first, and the whole follow-up model assumes the message we
    // already hold is the ORIGINAL and the new arrival is the reply. Processed newest-first that is
    // inverted: a 14-Aug "Reach at 9:45 …--Re: Seminar" was ingested before the 9-Aug seminar it
    // replies to, so the reply became the anchor and the real announcement looked like a follow-up
    // that "added a venue" — one seminar, two events. Chronological order makes every chain resolve
    // the way the logic expects.
    ids = ids.slice().reverse();

    const PACE_MS = Number(process.env.INGEST_PACE_MS) || 20000;
    const pace = groq.isConfigured() && ids.length > 8;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const id of ids) {
        try { await processMessage(id, senderMap, out, overrides, clubIndex, calendarEntries); if (pace) await sleep(PACE_MS); }
        catch (e) {
            if (gmail.isAuthError(e)) {   // token could expire mid-run
                await setState('auth_status', JSON.stringify({ ok: false, error: e.message, at: new Date().toISOString() }));
                return { authFailed: true, error: e.message, partial: out };
            }
            out.errors++; console.error('ingest message failed', id, e.message);
        }
    }

    // ADVANCE ONLY TO WHAT WE ENUMERATED — never to "whatever is newest now".
    //
    // This used to set the cursor to getProfile().historyId, the mailbox's CURRENT position at the
    // moment the run ended. A run is not instantaneous: with pacing it takes minutes, so any mail
    // arriving DURING it landed after the id list was fetched but before the cursor jumped past it,
    // and the next run started beyond it. Skipped permanently, with no row, no error and no log —
    // the message simply never existed as far as the app was concerned.
    //
    // Measured 2026-08-28: 1 of the 17 messages in the previous three days had vanished this way —
    // a Chess Selection Tournament with a round on 31 August, found only because someone asked where
    // it was. listHistory already returns the enumeration point; the caller was discarding it.
    //
    // Falls back to the profile only when there was nothing to enumerate from (first run, or a stale
    // cursor that forced a query backfill), where no such window exists.
    try {
        const next = enumeratedTo || (await gmail.getProfile()).historyId;
        await setState('gmail_history_id', next);
    } catch (e) { console.error('cursor update failed:', e.message); }
    out.at = new Date().toISOString();
    await setState('last_sync', JSON.stringify(out));   // heartbeat
    return out;
    } finally { ingestRunning = false; }
}

/**
 * The safety net under the history cursor.
 *
 * The fast path is a change feed, and a change feed can gap: the cursor race above lost a message,
 * and history can also legitimately expire or arrive incomplete. Any such loss is PERMANENT and
 * SILENT — no row, no error, nothing in the review queue — which for an app whose whole job is "do
 * not let students miss announcements" is the worst failure it has.
 *
 * So once an hour, ignore the cursor entirely and ask Gmail the real question: which messages match
 * the ingestion query? Anything with no ingested row gets processed. That turns a permanent loss into
 * a delay of at most an hour, and it is what found the missing Chess Selection Tournament.
 *
 * Cheap by construction — it compares ids BEFORE fetching anything, so on a healthy day it finds
 * nothing and costs one list call. CAPPED because the expensive resource is not CPU but the Groq
 * daily token budget (~2.7k per classification against 200k/day per key): a backlog after an outage
 * must drain over several hours rather than swallow a whole day's budget in one run, which would
 * silently downgrade every later message to regex classification.
 */
async function sweepForMissed({ days = 3, cap = 25 } = {}) {
    if (!gmail.isConfigured() || ingestRunning) return { skipped: true };
    const query = `${process.env.INGEST_QUERY || 'to:students-notices@iitr.ac.in'} newer_than:${days}d`;
    const ids = await gmail.listMessageIds({ query, max: 120 });
    if (!ids.length) return { checked: 0, missed: 0 };
    // Read the gmail ids through the model rather than raw SQL — the raw form needs the JSON `?`
    // operator, which collides with Sequelize's own bind-parameter placeholder.
    const rows = await IngestedEmail.findAll({ attributes: ['raw_snapshot'], raw: true });
    const seen = new Set(rows.map((r) => r.raw_snapshot && r.raw_snapshot.gmail_id).filter(Boolean));
    const missed = ids.filter((i) => !seen.has(i));
    if (!missed.length) return { checked: ids.length, missed: 0 };

    logger.warn({ missed: missed.length, checked: ids.length },
        'reconciliation sweep found mail the history cursor never delivered');
    const senderMap = await loadSenderMap();
    const clubIndex = await loadClubIndex();
    const calendarEntries = await loadCalendarEntries();
    const overrides = await loadOverrides();
    const out = { events: 0, notices: 0, calendar: 0, dismissed: 0, proposals: 0, skipped: 0, errors: 0, recovered: 0 };
    // Oldest first, for the same reason the main loop reverses: a reply must never be ingested before
    // the announcement it replies to, or it becomes the anchor and one event turns into two.
    for (const id of missed.slice().reverse().slice(0, cap)) {
        try { await processMessage(id, senderMap, out, overrides, clubIndex, calendarEntries); out.recovered++; }
        catch (e) { out.errors++; logger.error({ err: e, id }, 'sweep message failed'); }
    }
    return { checked: ids.length, missed: missed.length, ...out };
}

function startPolling() {
    if (!gmail.isConfigured()) {
        console.log('📭 Gmail ingestion disabled (set GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN to enable).');
        return;
    }
    // INGEST_POLL_SECONDS wins if set (near-live, e.g. 60); else INGEST_POLL_MINUTES (default 15).
    const secs = Number(process.env.INGEST_POLL_SECONDS) || Number(process.env.INGEST_POLL_MINUTES || 15) * 60;
    console.log(`📬 Gmail ingestion enabled — polling every ${secs}s.`);
    // Each cycle checks in with Sentry Cron — a MISSED check-in (poller silently died) alerts you, since a
    // dead poller looks healthy otherwise (health green, CPU flat, no error). Isolated: never crashes the app.
    const tick = async () => {
        sentry.pollerCheckIn('in_progress');
        try {
            const o = await runIngest();
            logger.info({ ingest: o }, 'ingest cycle');
            sentry.pollerCheckIn('ok');
        } catch (e) {
            logger.error({ err: e }, 'ingest cycle error');
            sentry.pollerCheckIn('error');
        }
    };
    tick();
    setInterval(tick, Math.max(15, secs) * 1000);   // floor 15s to stay well under Gmail rate limits

    // The reconciliation sweep, on its own much slower clock. Isolated exactly like the tick: a sweep
    // that throws must never take the poller or the app down with it.
    const sweepMins = Number(process.env.INGEST_SWEEP_MINUTES) || 60;
    console.log(`🧹 reconciliation sweep every ${sweepMins}m — catches mail the history cursor misses.`);
    setInterval(async () => {
        try {
            const r = await sweepForMissed();
            if (r && r.missed) logger.warn({ sweep: r }, 'sweep recovered missed mail');
        } catch (e) { logger.error({ err: e }, 'sweep failed'); }
    }, sweepMins * 60 * 1000);
}

// The loaders are exported so a diagnostic can rebuild EXACTLY the inputs a real ingest run uses.
// Re-implementing them in a script is how you end up debugging a pipeline that differs from the
// one in production — which is the failure this whole area keeps producing.
module.exports = {
    runIngest, startPolling, sweepForMissed, reviewProposals, processMessage,
    loadOverrides, matchOverride, emailAddr,
    loadSenderMap, loadClubIndex, loadCalendarEntries,
    posterBlock,   // exported so its output is tested against the real extractor, not a copy of it
};
