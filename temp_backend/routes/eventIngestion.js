const express = require('express');
const router = express.Router();
const { Event, Club, EventCategory, EventCategoryAlloted, Notice, EventProposal, IngestedEmail, IngestionState, AcademicCalendarEntry, AcademicCalendarImport, ClassificationOverride, AdminPermissionAlloted, ClubAdmin, SenderEntityMap, sequelize } = require('../database/schemas');
const { Op } = require('sequelize');
const { fail } = require('../utils/httpError');
const { runPipeline } = require('../services/eventIngestion');
const runner = require('../services/eventIngestion/runner');
const gmailSource = require('../services/eventIngestion/source/gmail');
const jwt = require('jsonwebtoken');
const { userData, verifySession } = require('../middlewares/userAuth');
const CFG = require('../services/eventIngestion/institutions/iitr.config');
const { Joi, validateBody, validateParams, id, isoDate, hhmm } = require('../middlewares/validate');
const { istToday, compareNotices } = require('../utils/noticeOrder');
const { PERM, permissionId } = require('../utils/permissions');
const { recordActivity, ACTIONS } = require('../utils/activityLog');

// The ENVELOPE is validated strictly; `payload` is left permissive on purpose. It is merged over the
// proposal's stored payload and then read field-by-field by publishEvent/publishNotice — never spread
// into a model write — so there is no mass-assignment surface, and locking its shape here would break
// publishing the moment the review UI adds a field.
const proposalIdParam = Joi.object({ id: id.required() });
const publishBody = Joi.object({
    payload: Joi.object().unknown(true),
    approvedType: Joi.string().valid('event', 'opportunity', 'info'),
    targetId: id.allow(null),
}).unknown(true);
const overrideBody = Joi.object({
    sender: Joi.string().trim().max(200).required(),
    pattern: Joi.string().trim().max(300).allow(null, ''),
    target_type: Joi.string().valid('event', 'opportunity', 'notice', 'calendar').required(),
});
const runQuery = Joi.object({ days: Joi.number().integer().min(1).max(365) });


// Only a super-admin (holds MANAGE_CLUB_ADMINS permission) may create/delete classification rules —
// a rule changes classification for EVERY student, so it's a governance action, not a club-admin one.
async function requireSuperAdmin(req, res, next) {
    try {
        // Shared verifier: signature + MANDATORY revocation check. This used to call jwt.verify
        // directly, so a revoked super-admin session still passed on the governance routes.
        const decoded = await verifySession(req.cookies?.auth_token || '');
        const uid = decoded.user_id || decoded.id;
        const ok = await AdminPermissionAlloted.findOne({ where: { user_id: uid, admin_permission_id: permissionId(PERM.MANAGE_CLUB_ADMINS) } });
        if (!ok) return res.status(403).json({ error: 'super-admin only' });
        req.superAdminId = uid;
        next();
    } catch { return res.status(401).json({ error: 'not authenticated' }); }
}

// Which proposals may this admin REVIEW? Mirrors routes/event.js `/admin/all`:
//  - a global event admin (permissionId(PERM.EVENT_CRUD)) or super-admin sees EVERYTHING (incl. Institute/unattributed)
//  - a club-scoped admin sees only proposals attributed to a club they manage (ClubAdmin table)
// Returns { all: boolean, clubIds: number[] }.
//
// Lives in utils/reviewScope.js because the notification generator fans review alerts out by the
// SAME rule. Two copies would drift silently — an admin pinged about an item they cannot open, or
// never pinged about one waiting for them.
const { reviewScope } = require('../utils/reviewScope');

// ── helpers ──────────────────────────────────────────────────────────────────
// Resolve a club NAME to its id, tolerantly.
//
// This was an exact match with a silent fallback to Institute, which is the worst combination: any
// difference at all between the name the pipeline produced and the name stored in the club table sent
// the event to Institute with no error anywhere. Two real cases in the live table:
//   · "Fine Arts " is stored WITH A TRAILING SPACE, so the pipeline's "Fine Arts" never matched it.
//   · "Cinema Club" vs a shorter "Cinema" — one extra word is enough to lose the attribution.
// Attribution failures look like a classifier problem and are actually this lookup, which is why they
// were hard to see: the pipeline had the right answer and the write threw it away.
//
// Matching is trim + case-insensitive, then a "Club"/"Section"/"Cell" suffix is ignored, both
// directions. Anything less certain than that is NOT guessed — a wrong club is worse than Institute,
// because it puts an event on some other club's page.
async function clubIdByName(name) {
    const wanted = String(name || '').trim();
    if (!wanted || wanted.toLowerCase() === 'institute') {
        const inst = await Club.findOne({ where: { name: 'Institute' } });
        return inst ? inst.id : null;
    }

    const rows = await Club.findAll({ attributes: ['id', 'name'], raw: true });
    const norm = (x) => String(x || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const bare = (x) => norm(x).replace(/\s+(club|section|cell|society|group|team|chapter)$/g, '').trim();

    const target = norm(wanted);
    let hit = rows.find((r) => norm(r.name) === target);
    if (!hit) {
        const t = bare(wanted);
        const matches = rows.filter((r) => bare(r.name) === t);
        if (matches.length === 1) hit = matches[0];
    }
    if (!hit) {
        // A club is often written by its SHORT NAME while the table stores the long one: mail says
        // "CineSec", the row says "CineSec Cinematics Section IITR". Match on the first word when that
        // word identifies exactly one club and is long enough to mean something (>=4 chars).
        //
        // "Exactly one" is doing real work here. "Chess" is the first word of BOTH "Chess Club" and
        // "ChESS (Chemical Engineering Student Society)" — two entirely different societies — so a
        // bare "Chess" is refused and falls to Institute rather than guessing between them.
        const t = bare(wanted).replace(/[^a-z0-9 ]/g, '');
        const firstWord = (x) => norm(x).split(' ')[0].replace(/[^a-z0-9]/g, '');
        if (t.length >= 4 && !t.includes(' ')) {
            const byFirst = rows.filter((r) => firstWord(r.name) === t);
            if (byFirst.length === 1) hit = byFirst[0];
        }
    }
    if (hit) return hit.id;

    const inst = await Club.findOne({ where: { name: 'Institute' } });
    return inst ? inst.id : null;
}

// Build a senderMap dict from the DB sender_entity_map + fest/homogeneous clubs.
async function loadSenderMap() {
    const rows = await SenderEntityMap.findAll({ include: [{ model: Club, attributes: ['name'] }] });
    const map = {};
    for (const r of rows) if (r.Club) map[r.match_value] = r.Club.name;
    return map;
}

async function publishEvent(payload, clubName, email) {
    const club_id = await clubIdByName(clubName);
    // event.tentative_start_time is NOT NULL — fall back to a near-future placeholder for
    // dateless (tentative) items so they still surface for the admin to fix.
    // Real start time from the normalized time_start ("HH:MM" IST); no time → ALL-DAY (T00:00), never a fake 9 AM.
    const startTime = /^\d{2}:\d{2}$/.test(payload.time_start || '') ? payload.time_start : null;
    const base = payload.startDate ? new Date(`${payload.startDate}T${startTime || '00:00'}:00+05:30`)
        : new Date(Date.now() + 7 * 864e5);
    // MULTI-DAY: an endDate later than startDate → span it via duration_minutes (same as the manual
    // create form; EventCard renders the date range from a >=1-day duration). Else the extracted/default.
    let duration = payload.duration_minutes || 120;
    if (payload.endDate && payload.startDate && payload.endDate > payload.startDate) {
        const end = new Date(`${payload.endDate}T${startTime || '23:59'}:00+05:30`);
        const d = Math.round((end - base) / 60000);
        if (d > 0) duration = d;
    }
    const ev = await Event.create({
        name: payload.title,
        club_id,
        tentative_start_time: base,
        duration_minutes: duration,
        is_all_day: !startTime,                            // single source of truth for all-day
        description: payload.description || null,          // separate, cleaned — NOT the title, no logistics
        // A deferred room is not a place: keep venue_text null and let venue_mode say "to be announced",
        // so it can never be confused with an online event (which has no room at all).
        venue_text: payload.venue_mode === 'tba' ? null : (payload.venue || null),
        venue_mode: payload.venue_mode || null,
        image_url: payload.poster_url || null,             // club-email poster attachment, if any
        source: 'email',
        status: 'scheduled',
        source_sender: (email && email.from) || null,
        source_message_id: (email && email.message_id) || null,
        registration_link: payload.registration_link || null,
        registration_deadline: payload.registration_deadline || null,
        audience: payload.audience || null,
    });
    // link categories by name
    for (const catName of payload.categories || []) {
        const cat = await EventCategory.findOne({ where: { name: catName } });
        if (cat) await EventCategoryAlloted.findOrCreate({ where: { event_id: ev.id, event_category_id: cat.id } });
    }
    return ev;
}

async function publishNotice(payload, email) {
    // A notice from a club belongs to that club. Institute/unknown stays NULL — an office announcement
    // genuinely has no club, and storing Institute would make "no club" indistinguishable from "the
    // Institute club", which the club page and the review routing both care about.
    const clubName = (payload.club || '').trim();
    const club_id = (clubName && clubName !== 'Institute') ? await clubIdByName(clubName) : null;
    return Notice.create({
        club_id,
        title: payload.title,
        body: payload.body || null,
        priority: payload.priority || 'general',
        link: payload.link || null,
        deadline: payload.deadline || null,
        // Only a DERIVED date is stamped. A date the email stated leaves this null, which is what makes
        // "the app looked this up" distinguishable from "the email said so" on the card and in review.
        deadline_source: payload.deadline && payload.deadline_source === 'calendar' ? 'calendar' : null,
        deadline_time: /^\d{2}:\d{2}$/.test(payload.deadline_time || '') ? payload.deadline_time : null,
        event_date: payload.event_date || null,
        time_start: /^\d{2}:\d{2}$/.test(payload.time_start || '') ? payload.time_start : null,
        // 'Online' is a real place; a deferred room is NOT a place and must stay null, with venue_mode
        // carrying the distinction — writing "TBA" into venue would make it indistinguishable from a
        // venue actually named "TBA" and would render as though a location had been decided.
        venue: payload.venue_mode === 'tba' ? null : (payload.venue || null),
        venue_mode: payload.venue_mode || null,
        open_ended: !!payload.open_ended,
        audience: payload.audience || null,
        kind: payload.kind || null,
        is_opportunity: !!payload.is_opportunity,
        // MUST be copied explicitly. This function writes the Notice column by column, so a payload
        // field that is not named here is silently dropped and the column falls back to its default —
        // is_external went to `false` on every newly published notice however the pipeline had
        // classified it. The backfill had corrected the rows already stored, so the EXTERNAL chip
        // looked correct while quietly being wrong for everything published from then on. Adding a
        // notice column means adding it HERE too.
        is_external: !!payload.is_external,
        source: payload.source || null,
        source_message_id: (email && email.message_id) || null,
        published_at: new Date(),
    });
}

// current committed academic-calendar scope (semester the email should attach to)
async function currentCalendarScope() {
    const imp = await AcademicCalendarImport.findOne({ where: { status: 'committed' }, order: [['created_at', 'DESC']] });
    return imp
        ? { institution: imp.institution, program: imp.program, semester: imp.semester }
        : { institution: 'IITR', program: 'general', semester: 'General' };
}
const calSlug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

// Email → academic calendar. mode 'amend' updates an existing entry's date/status; 'add' creates a
// new email-sourced day-status row. Only holiday / working-day (incl. timetable) ever reach here.
async function publishCalendar(payload, body) {
    const scope = await currentCalendarScope();
    const isHoliday = payload.cal_kind === 'holiday';
    const title = (body && body.payload && body.payload.title) || payload.title;
    const start = (body && body.payload && body.payload.startDate) || payload.startDate || null;
    const end = (body && body.payload && body.payload.endDate) || payload.endDate || start || null;
    const category = isHoliday ? 'Holiday' : /time-?table|reschedul/i.test(title || '') ? 'Timetable Reschedule' : 'Working Day';

    if (body && body.mode === 'amend' && body.targetId) {
        const entry = await AcademicCalendarEntry.findByPk(body.targetId);
        if (!entry) { const e = new Error('target calendar entry not found'); e.code = 'NO_TARGET'; throw e; }
        await entry.update({ start_date: start || entry.start_date, end_date: end || entry.end_date, is_holiday: isHoliday, description: title, tentative: !(start || entry.start_date), source: 'email' });
        return { amended: entry.id };
    }
    // add a new email-sourced day-status row
    const id = `email-${calSlug(scope.semester)}-${calSlug(title)}-${start || 'tbd'}`;
    await AcademicCalendarEntry.upsert({
        id, ...scope, title, category, start_date: start, end_date: end,
        description: title, is_holiday: isHoliday, source: 'email', tentative: !start, sort_order: 9000,
    });
    return { added: id };
}

// candidate existing entries a calendar email might be AMENDING (keyword overlap, current semester).
async function calendarCandidates(payload) {
    const scope = await currentCalendarScope();
    const rows = await AcademicCalendarEntry.findAll({ where: scope, raw: true });
    const stop = new Set(['the', 'of', 'on', 'for', 'and', 'to', 'in', 'a', 'holiday', 'day', 'observation', 'reg', 'notification', 'instead', 'due', 'teaching']);
    const words = (s) => (s || '').toLowerCase().match(/[a-z]{3,}/g) || [];
    const pw = new Set(words(payload.title).filter((w) => !stop.has(w)));
    return rows
        .map((r) => ({ ...r, score: words(r.title).filter((w) => pw.has(w)).length }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((r) => ({ id: r.id, title: r.title, category: r.category, start_date: r.start_date, is_holiday: r.is_holiday, source: r.source }));
}

// Append a short provenance note to an event's description (keeps the change history human-readable).
function appendNote(desc, note) {
    const clean = (desc || '').trim();
    return clean ? `${clean}\n\n— ${note}` : note;
}

// Apply a PATCH_EVENT / CANCEL_EVENT to a live event the admin picked (body.targetId). We never guess
// the target — like calendar amend, the human confirms which event this update refers to.
async function applyLifecycle(proposal, payload, body, scope) {
    const targetId = body && body.targetId;
    if (!targetId) { const e = new Error('Pick the event this update applies to.'); e.code = 'NO_TARGET'; throw e; }
    const ev = await Event.findByPk(targetId);
    if (!ev) { const e = new Error('Target event not found.'); e.code = 'NO_TARGET'; throw e; }
    // IDOR guard: a club-scoped admin may only reschedule/cancel events belonging to a club they manage —
    // the target event is client-supplied (body.targetId), so re-check it against the caller's scope here.
    if (scope && !scope.all && !scope.clubIds.includes(Number(ev.club_id))) {
        const e = new Error('You can only modify events for clubs you manage.'); e.code = 'FORBIDDEN_TARGET'; throw e;
    }

    if (proposal.mutation_type === 'CANCEL_EVENT') {
        await ev.update({ status: 'cancelled', description: appendNote(ev.description, `Cancelled via email: ${payload.title || ''}`.trim()) });
        return { target_event_id: ev.id };
    }
    // PATCH_EVENT — reschedule / venue change. Venue → the structured venue_text field (NOT a description
    // note); a new date+time moves tentative_start_time via the same normalized time logic as publish.
    // An event whose time was merely ANNOUNCED late was never rescheduled — nothing moved, we just did
    // not know it yet — so it must not wear the "Rescheduled" badge. Only a real reschedule sets that.
    const announcedNotMoved = (proposal.payload && proposal.payload.lifecycle) === 'schedule_announced';
    const patch = announcedNotMoved ? { status: 'scheduled' } : { status: 'rescheduled' };
    if (payload.startDate) {
        const st = /^\d{2}:\d{2}$/.test(payload.time_start || '') ? payload.time_start : null;
        patch.tentative_start_time = new Date(`${payload.startDate}T${st || '00:00'}:00+05:30`);
        patch.is_all_day = !st;
        if (payload.duration_minutes) patch.duration_minutes = payload.duration_minutes;
        // MULTI-DAY: an endDate beyond the start spans the event via duration, same as publishEvent.
        if (payload.endDate && payload.endDate > payload.startDate) {
            const end = new Date(`${payload.endDate}T${st || '23:59'}:00+05:30`);
            const mins = Math.round((end - patch.tentative_start_time) / 60000);
            if (mins > 0) patch.duration_minutes = mins;
        }
    }
    if (payload.venue) patch.venue_text = payload.venue;
    // The Updates card is the FULL review card, so an update carries everything a create does — a reply
    // email routinely supplies the registration link, a real description or the club the first mail
    // never named. Previously only date/venue/status were written and every other correction the
    // reviewer made on that card was silently discarded on save.
    // Guarded per field: only overwrite when the card actually carries a value, so an untouched field
    // never blanks what is already live.
    if (payload.title) patch.name = payload.title;
    if (payload.description) patch.description = payload.description;
    if (payload.venue_mode) patch.venue_mode = payload.venue_mode;
    const regLink = payload.registration_link || payload.link;
    if (regLink) patch.registration_link = regLink;
    if (payload.registration_deadline) patch.registration_deadline = payload.registration_deadline;
    if (payload.poster_url) patch.image_url = payload.poster_url;
    if (payload.club) {
        const cid = await clubIdByName(payload.club);
        // never re-attribute out of a club-scoped admin's own clubs (same guard as publish)
        if (cid && (!scope || scope.all || scope.clubIds.includes(Number(cid)))) patch.club_id = cid;
    }
    await ev.update(patch);
    // Categories are a join table, not a column — mirror publishEvent and add any the card selected.
    for (const catName of payload.categories || []) {
        const cat = await EventCategory.findOne({ where: { name: catName } });
        if (cat) await EventCategoryAlloted.findOrCreate({ where: { event_id: ev.id, event_category_id: cat.id } });
    }
    return { target_event_id: ev.id };
}

// PATCH_NOTICE — a deadline extension applied to a LIVE notice the admin picks (never auto-matched,
// same rule as the event lifecycle). Only the apply-by moves; title/body/link are left alone, because
// an extension mail is a correction to one field, not a re-announcement.
async function applyNoticeLifecycle(proposal, payload, body) {
    const targetId = body && body.targetId;
    if (!targetId) { const e = new Error('Pick the notice this extension applies to.'); e.code = 'NO_TARGET'; throw e; }
    const n = await Notice.findByPk(targetId);
    if (!n) { const e = new Error('Target notice not found.'); e.code = 'NO_TARGET'; throw e; }
    if (!payload.deadline) { const e = new Error('No new deadline found in this email — set one before applying.'); e.code = 'NO_TARGET'; throw e; }
    // Never move a deadline BACKWARDS from an extension mail: that is the signature of having matched
    // the wrong notice, or of the parser picking up the old date quoted in the body.
    if (n.deadline && String(payload.deadline) <= String(n.deadline)) {
        const e = new Error(`That notice already closes ${n.deadline}; ${payload.deadline} is not an extension.`);
        e.code = 'NO_TARGET'; throw e;
    }
    await n.update({
        deadline: payload.deadline,
        deadline_time: /^\d{2}:\d{2}$/.test(payload.deadline_time || '') ? payload.deadline_time : null,
        expires_at: null,        // a re-opened item must not stay archived under the old date
    });
    return { target_notice_id: n.id };
}

// candidate live notices a deadline-extension email might refer to. Same keyword-overlap approach as
// eventCandidates, restricted to notices that HAVE a deadline (only those can be extended).
async function noticeCandidates(payload) {
    const { Op } = require('sequelize');
    // Deliberately NOT restricted to notices that already have a deadline. It used to be, on the
    // reasoning that only a dated notice can have its date "extended" — but the commonest real case is
    // the opposite: a notice that never carried a date at all, followed later by the mail that supplies
    // one. "Option for 'Course Drop' on AIS portal" states no date anywhere and points at the academic
    // calendar PDF instead, so under the old filter the follow-up naming the last date could never
    // match it and would have been published as a SECOND, competing notice.
    const rows = await Notice.findAll({
        attributes: ['id', 'title', 'deadline', 'kind', 'source'], raw: true,
        order: [['published_at', 'DESC']], limit: 300,
    });
    const stop = new Set(['the', 'of', 'on', 'for', 'and', 'to', 'in', 'a', 'by', 'last', 'date', 'deadline', 'extended',
        'extension', 'reminder', 'notice', 'update', 'reg', 'gentle', 'applications', 'application', 'registration', 'apply']);
    const words = (s) => (s || '').toLowerCase().match(/[a-z]{3,}/g) || [];
    const pw = new Set(words(payload.title).filter((w) => !stop.has(w)));
    if (!pw.size) return [];
    return rows
        .map((r) => ({ id: r.id, title: r.title, deadline: r.deadline, kind: r.kind, source: r.source, score: words(r.title).filter((w) => pw.has(w)).length }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
}

// the human-readable "type" a proposal was classified as — the ORIGINAL side of the feedback loop.
function originalTypeOf(p) {
    if (p.mutation_type === 'CREATE_EVENT') return 'event';
    if (p.mutation_type === 'CREATE_NOTICE') return (p.payload && p.payload.is_opportunity) ? 'opportunity' : 'info';
    if (p.mutation_type === 'CALENDAR_ENTRY') return 'calendar';
    if (p.mutation_type === 'PATCH_EVENT') return 'patch';
    if (p.mutation_type === 'PATCH_NOTICE') return 'deadline_extended';
    if (p.mutation_type === 'CANCEL_EVENT') return 'cancel';
    return p.mutation_type;
}

// candidate live events a PATCH/CANCEL email might refer to (keyword overlap on name, not-cancelled,
// roughly current). The admin picks; we never auto-match a lifecycle mutation onto an event.
async function eventCandidates(payload) {
    const { Op } = require('sequelize');
    // The candidate carries the live event's CURRENT values, not just its name: the Updates card merges
    // them underneath the reply email's new ones so the reviewer approves the finished item rather than
    // a bare diff. Without these the merge had nothing to fill blanks from.
    const rows = await Event.findAll({
        where: { status: { [Op.ne]: 'cancelled' }, tentative_start_time: { [Op.gte]: new Date(Date.now() - 45 * 864e5) } },
        attributes: ['id', 'name', 'tentative_start_time', 'status', 'club_id', 'description',
            'venue_text', 'venue_mode', 'registration_link', 'registration_deadline', 'duration_minutes', 'is_all_day'],
        include: [{ model: Club, attributes: ['name'], required: false }],
        raw: true, nest: true, limit: 300,
    });
    const stop = new Set(['the', 'of', 'on', 'for', 'and', 'to', 'in', 'a', 'by', 'session', 'talk', 'event', 'reminder', 'invitation', 'update', 'reg', 'gentle', 'postponed', 'rescheduled', 'cancelled', 'revised', 'change', 'today']);
    const words = (s) => (s || '').toLowerCase().match(/[a-z]{3,}/g) || [];
    const pw = new Set(words(payload.title).filter((w) => !stop.has(w)));
    if (!pw.size) return [];
    const top = rows
        .map((r) => ({
            id: r.id, name: r.name, start: r.tentative_start_time, status: r.status,
            description: r.description, venue_text: r.venue_text, venue_mode: r.venue_mode,
            registration_link: r.registration_link, registration_deadline: r.registration_deadline,
            duration_minutes: r.duration_minutes, is_all_day: r.is_all_day,
            club_name: (r.Club && r.Club.name) || null,
            score: words(r.name).filter((w) => pw.has(w)).length,
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
    // Categories live in a join table, so fetch them only for the handful we actually return.
    if (top.length) {
        const links = await EventCategoryAlloted.findAll({
            where: { event_id: { [Op.in]: top.map((t) => t.id) } },
            include: [{ model: EventCategory, attributes: ['name'], required: false }],
            raw: true, nest: true,
        });
        const byEvent = {};
        for (const l of links) {
            const n = l.EventCategory && l.EventCategory.name;
            if (n) (byEvent[l.event_id] = byEvent[l.event_id] || []).push(n);
        }
        for (const t of top) t.categories = byEvent[t.id] || [];
    }
    return top;
}

// Public Notices are readable by anyone, so never emit internal provenance (the Gmail message id and the
// raw sender string are operational metadata with no UI purpose — stripped before the response).
function publicNotice(n) {
    if (!n) return n;
    const { source, source_message_id, Club: club, ...rest } = n;
    // The club NAME is the one piece of provenance the UI genuinely needs — it is who is organising,
    // not internal metadata. (`source`, the raw sender string, stays stripped.) Without it a club's
    // recruitment card had nothing to show where an event card shows the club.
    return { ...rest, club_name: (club && club.name) || null };
}

// ── GET /ingestion/notices — the Notices tab feed ────────────────────────────
// important first, then nearest-deadline first (Fable's cheap win), then general.
// Login required. These were the ONLY endpoints serving app data to an anonymous caller — every other
// route already 401s — so the whole notice feed, 44KB of it, was readable by anyone on the internet
// without a Channel-i account. The app is for verified IITR students; the data should not be a public
// API. Verified by sweeping every endpoint unauthenticated.
router.get('/notices', userData, async (req, res) => {
    try {
        const rows = await Notice.findAll({
            where: { published_at: { [require('sequelize').Op.ne]: null } },
            include: [{ model: Club, attributes: ['name'], required: false }],
            raw: true, nest: true,
        });
        // Important first, soonest deadline first — and EXPIRED sinks below everything. See
        // utils/noticeOrder.js for why (the first twelve notices prod served were all expired).
        const today = istToday();
        rows.sort((a, b) => compareNotices(a, b, today));
        res.json({ notices: rows.map(publicNotice) });
    } catch (e) {
        console.error('notices fetch failed:', e);
        res.status(500).json({ error: 'Could not fetch notices' });
    }
});

// ── GET /ingestion/notices/:id — one notice (detail view) ────────────────────
router.get('/notices/:id', userData, async (req, res) => {
    try {
        // Reject a non-numeric or out-of-range id up front: a BIGINT cast error was surfacing as a 500,
        // which is both wrong (it's bad input, not a server fault) and noise in Sentry.
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
        const n = await Notice.findByPk(id, { raw: true });
        // The list route filters on published_at; this one must too, or an unpublished/draft notice
        // becomes readable by id to anyone while correctly hidden from the feed. No draft rows exist
        // today, so this is closing the hole before a scheduling/hold workflow opens it.
        if (!n || !n.published_at) return res.status(404).json({ error: 'Not found' });
        res.json({ notice: publicNotice(n) });
    } catch (e) {
        console.error('notice fetch failed:', e);
        res.status(500).json({ error: 'Could not fetch notice' });
    }
});

// ── Notice ADMIN (edit / delete) ─────────────────────────────────────────────
// Notices were write-once: created by publishing a proposal, then frozen forever — no PATCH, no
// DELETE, no admin tab, while events had all three. Any error baked in at publish time (a dropped
// apply-by, a club mis-attributed to Institute, a stale item) was uncorrectable through the app.
// Scoped exactly like the review queue via reviewScope(): a club admin may touch their own club's
// notices, a global/super admin any. An office notice (club_id NULL) is global-admin only — it
// belongs to no club, so no club admin should be able to reach it.
async function noticeInScope(noticeId, userId) {
    const n = await Notice.findByPk(noticeId);
    if (!n) return { err: 404 };
    const scope = await reviewScope(userId);
    if (scope.all) return { n };
    if (n.club_id == null) return { err: 403 };
    return scope.clubIds.includes(Number(n.club_id)) ? { n } : { err: 403 };
}

// Mirrors the Notice columns a human may correct. `published_at`, `source*` and the id stay
// server-owned — provenance is not editable.
const noticePatchBody = Joi.object({
    title: Joi.string().trim().min(1).max(300),
    body: Joi.string().trim().max(8000).allow(null, ''),
    priority: Joi.string().valid('important', 'general'),
    link: Joi.string().trim().max(1000).allow(null, ''),
    deadline: isoDate,
    deadline_time: hhmm,        // hhmm rejects 25:70 — the column is a bare STRING(5) and would store it
    event_date: isoDate,
    time_start: hhmm,
    venue: Joi.string().trim().max(300).allow(null, ''),
    venue_mode: Joi.string().valid('online', 'physical', 'tba').allow(null, ''),
    open_ended: Joi.boolean(),
    audience: Joi.string().trim().max(24).allow(null, ''),   // column is STRING(24) — reject early, don't 500 in the driver
    kind: Joi.string().trim().max(24).allow(null, ''),
    is_opportunity: Joi.boolean(),
    is_external: Joi.boolean(),
    deadline_source: Joi.string().valid('calendar').allow(null, ''),
    club_id: id.allow(null),
}).min(1);

// Everything a human may set when WRITING a notice by hand. Same field set as the patch above minus
// `deadline_source`: that column records that the app DERIVED a date from the academic calendar, and a
// date typed into this form is by definition a stated one. Accepting it here would let the card claim
// provenance the notice never had.
const noticeCreateBody = noticePatchBody.keys({
    title: Joi.string().trim().min(1).max(300).required(),
    deadline_source: Joi.any().forbidden(),
}).min(1);

// POST /ingestion/notices — publish a notice written by hand.
//
// Until now every notice in the app had to arrive as an email: the only way to create one was to
// approve a proposal from the review queue. Anything that was never mailed to students-notices — a
// correction, a same-day announcement passed on in person, an item whose source mail was dismissed at
// a gate — had no route into the feed at all.
//
// Scoped exactly like PATCH/DELETE via reviewScope(), including the office-notice rule: club_id null
// means the notice belongs to no club, so only a global/super admin may post one. A club admin
// omitting the club would otherwise silently publish institute-wide.
router.post('/notices', userData, validateBody(noticeCreateBody), async (req, res) => {
    try {
        const scope = await reviewScope(req.user.user_id);
        const clubId = req.body.club_id ?? null;
        if (!scope.all) {
            if (clubId == null) return res.status(403).json({ error: 'only a global admin can post an office notice' });
            if (!scope.clubIds.includes(Number(clubId))) return res.status(403).json({ error: 'not your club' });
        }

        const row = {};
        for (const [k, v] of Object.entries(req.body)) row[k] = v === '' ? null : v;
        const created = await Notice.create({
            ...row,
            club_id: clubId,
            deadline_source: null,
            // Internal provenance only — publicNotice() strips it before the response. Worth storing so
            // a hand-written notice is distinguishable from an email-sourced one in the table.
            source: 'manual',
            source_message_id: null,
            // The Notices feed selects on `published_at IS NOT NULL`; without this the notice would be
            // created and then be invisible to every screen that reads it.
            published_at: new Date(),
        });

        // Re-read through the Club include so the row handed back carries club_name and the admin table
        // can render it without a full refresh.
        const full = await Notice.findByPk(created.id, {
            include: [{ model: Club, attributes: ['name'], required: false }],
            raw: true, nest: true,
        });
        await recordActivity(req, {
            action: ACTIONS.NOTICE_POSTED_MANUAL,
            detail: { notice_id: created.id, title: created.title, club_id: clubId, priority: created.priority },
        });
        res.status(201).json({ ok: true, notice: publicNotice(full) });
    } catch (e) { fail(res, 500, 'notice create failed', e); }
});

// PATCH /ingestion/notices/:id — correct a live notice
router.patch('/notices/:id', userData, validateParams(proposalIdParam), validateBody(noticePatchBody), async (req, res) => {
    try {
        const { n, err } = await noticeInScope(req.params.id, req.user.user_id);
        if (err) return res.status(err).json({ error: err === 404 ? 'Not found' : 'not your club' });
        // A club admin cannot re-attribute a notice to a club they do not manage (IDOR guard, same
        // shape as the publish route's club pin).
        if (req.body.club_id !== undefined) {
            const scope = await reviewScope(req.user.user_id);
            if (!scope.all && !scope.clubIds.includes(Number(req.body.club_id))) {
                return res.status(403).json({ error: 'not your club' });
            }
        }
        const patch = {};
        for (const [k, v] of Object.entries(req.body)) patch[k] = v === '' ? null : v;
        // A human (or a later email) setting the deadline makes it STATED, not derived — otherwise the
        // card would keep claiming the date came from the academic calendar after someone corrected it.
        if (Object.prototype.hasOwnProperty.call(req.body, 'deadline') && req.body.deadline_source === undefined) {
            patch.deadline_source = null;
        }
        await n.update(patch);
        res.json({ ok: true, notice: publicNotice(n.get({ plain: true })) });
    } catch (e) { fail(res, 500, 'notice update failed', e); }
});

// DELETE /ingestion/notices/:id — remove a live notice.
// Deliberately does NOT touch the source proposal or ingested_email: deleting is not a re-ingest, and
// silently re-queueing an item the reviewer just removed would fight them. To pull an email in again,
// clear its ingested_email row so the next Gmail poll re-fetches it (the pipeline dedups on message_id).
router.delete('/notices/:id', userData, validateParams(proposalIdParam), async (req, res) => {
    try {
        const { n, err } = await noticeInScope(req.params.id, req.user.user_id);
        if (err) return res.status(err).json({ error: err === 404 ? 'Not found' : 'not your club' });
        await n.destroy();
        res.json({ ok: true, deleted: Number(req.params.id) });
    } catch (e) { fail(res, 500, 'notice delete failed', e); }
});

// ── GET /ingestion/proposals — pending drafts (audit) ────────────────────────
router.get('/proposals', userData, async (req, res) => {
    try {
        const scope = await reviewScope(req.user.user_id);
        const where = { state: 'proposed' };
        if (!scope.all) {
            if (!scope.clubIds.length) return res.json({ proposals: [] });   // manages no clubs → nothing to review
            where.club_id = { [Op.in]: scope.clubIds };                       // only this admin's clubs' proposals
        }
        const rows = await EventProposal.findAll({ where, order: [['id', 'DESC']], raw: true });
        res.json({ proposals: rows });
    } catch (e) { res.status(500).json({ error: 'Could not fetch proposals' }); }
});

// ── GET /ingestion/status — is Gmail wired, and the last sync heartbeat ──────
router.get('/status', userData, async (req, res) => {
    try {
        const last = await IngestionState.findByPk('last_sync');
        const cursor = await IngestionState.findByPk('gmail_history_id');
        const auth = await IngestionState.findByPk('auth_status');
        const authStatus = auth ? JSON.parse(auth.value) : null;
        res.json({
            gmailConfigured: gmailSource.isConfigured(),
            authOk: authStatus ? authStatus.ok : null,     // false ⇒ token expired/revoked, ingestion stopped
            authStatus,
            lastSync: last ? JSON.parse(last.value) : null,
            cursor: cursor ? cursor.value : null,
        });
    } catch (e) { fail(res, 500, 'status failed', e); }
});

// ── POST /ingestion/verify — confirm the Gmail credentials actually work ──────
router.post('/verify', userData, async (req, res) => {
    const scope = await reviewScope(req.user.user_id);
    if (!scope.all) return res.status(403).json({ error: 'global admin only' });   // operational action → gate like /run
    if (!gmailSource.isConfigured()) return res.json({ configured: false });
    try { res.json({ configured: true, ...(await gmailSource.verify()) }); }
    catch (e) { console.error('gmail verify failed:', e?.message); res.status(400).json({ configured: true, ok: false }); }
});

// ── POST /ingestion/run — pull new Gmail, run pipeline, write proposals ──────
// No-ops (disabled:true) until Gmail credentials are configured in env.
router.post('/run', userData, async (req, res) => {
    try {
        const scope = await reviewScope(req.user.user_id);
        if (!scope.all) return res.status(403).json({ error: 'global admin only' });   // pulls the whole mailbox
        // Clamp the backfill window. Unbounded, `?days=99999` becomes a `newer_than:99999d` Gmail
        // query that walks years of mail in one request: it holds the event loop for minutes and
        // burns the whole Groq daily allowance (100k tokens/day, ~50 emails), after which the
        // pipeline silently degrades to the regex fallback for EVERY later email that day — a
        // quality failure with no error anywhere. 365 covers any real backfill; the default is 30.
        // Math.floor also stops a float or `1e999` (-> Infinity) reaching the query string.
        const requestedDays = Math.floor(Number(req.query.days));
        const backfillDays = Number.isFinite(requestedDays) && requestedDays > 0
            ? Math.min(requestedDays, 365)
            : 30;
        const out = await runner.runIngest({ backfillDays });
        res.json(out);
    } catch (e) {
        console.error('ingest run failed:', e);
        fail(res, 500, 'ingest run failed', e);
    }
});

// ── POST /ingestion/proposals/:id/publish — proposal → real event/notice ─────
router.post('/proposals/:id/publish', userData, validateParams(proposalIdParam), validateBody(publishBody), async (req, res) => {
    try {
        const p = await EventProposal.findByPk(req.params.id);
        if (!p) return res.status(404).json({ error: 'Not found' });
        const scope = await reviewScope(req.user.user_id);
        if (!scope.all && !scope.clubIds.includes(Number(p.club_id))) return res.status(403).json({ error: 'not your club' });
        if (p.state === 'published') return res.json({ ok: true, already: true });
        // Admin may correct the pre-filled fields before publishing — merge their edits over the proposal.
        const payload = { ...(p.payload || {}), ...((req.body && req.body.payload) || {}) };
        // IDOR guard: a club-scoped admin cannot re-attribute the published event to another club by
        // overriding payload.club — pin it to the proposal's own (already scope-checked) club. Super admins
        // (scope.all) manage every club, so they keep the freedom to set it.
        if (!scope.all) {
            const ownClub = await Club.findByPk(Number(p.club_id), { attributes: ['name'] });
            if (ownClub) payload.club = ownClub.name;
        }
        const email = { from: payload._from || null, message_id: payload._message_id || null };
        const extra = {};   // provenance fields to persist alongside state (e.g. lifecycle target)
        const originalType = originalTypeOf(p);
        // Admin may RECLASSIFY across the three feed types before publishing (Event / Opportunity / Info) —
        // the corrections we learn from. Calendar/lifecycle keep their dedicated flows and ignore this.
        const override = ['event', 'opportunity', 'info'].includes(req.body && req.body.approvedType) ? req.body.approvedType : null;
        const approvedType = override || originalType;

        // A LIFECYCLE proposal with a chosen target is always an UPDATE of that live event — checked
        // before `override` so it can never fall through to the create path and spawn a duplicate.
        // The Updates tab now sends the full review card, which carries a type field like any other, and
        // without this guard that field would route a "reschedule" into publishEvent() and put a second
        // copy of the event on the feed while the original kept the stale date.
        // WITHOUT a target it deliberately does fall through: when the original was never published
        // there is nothing to patch, so the merged card is published as a new event instead.
        const isEventLifecycle = p.mutation_type === 'PATCH_EVENT' || p.mutation_type === 'CANCEL_EVENT';
        if (isEventLifecycle && req.body && req.body.targetId) {
            const r = await applyLifecycle(p, payload, req.body, scope);
            if (r && r.target_event_id != null) extra.target_event_id = r.target_event_id;
        }
        else if (override) {
            if (override === 'event') await publishEvent(payload, payload.club, email);
            else await publishNotice({ ...payload, is_opportunity: override === 'opportunity' }, email);
        }
        else if (p.mutation_type === 'CREATE_EVENT') await publishEvent(payload, payload.club, email);
        else if (p.mutation_type === 'CREATE_NOTICE') await publishNotice(payload, email);
        else if (p.mutation_type === 'CALENDAR_ENTRY') await publishCalendar(payload, req.body);   // amend or add a day-status row
        else if (p.mutation_type === 'PATCH_EVENT' || p.mutation_type === 'CANCEL_EVENT') {
            const r = await applyLifecycle(p, payload, req.body, scope);   // update the live event the admin picked
            if (r && r.target_event_id != null) extra.target_event_id = r.target_event_id;
        }
        else if (p.mutation_type === 'PATCH_NOTICE') await applyNoticeLifecycle(p, payload, req.body);   // move a live notice's apply-by
        else return res.status(400).json({ error: 'unsupported mutation for publish', type: p.mutation_type });

        // Feedback loop: record what was proposed vs what the human approved (drives GET /drift).
        const feedback = {
            original_type: originalType,
            approved_type: approvedType,
            changed: approvedType !== originalType,
            edited: !!(req.body && req.body.payload && Object.keys(req.body.payload).length),
        };
        const evidence = { ...(p.evidence || {}), feedback };
        await p.update({ state: 'published', payload, evidence, ...extra });   // persist edits + feedback for provenance

        // WHO approved this, and when. evidence.feedback records what changed but never the actor, so
        // until now every published item was authorless. Not awaited into the response path beyond
        // this — a failed audit must not fail a completed publish.
        await recordActivity(req, {
            action: approvedType === 'event' ? ACTIONS.EVENT_PUBLISHED : ACTIONS.NOTICE_PUBLISHED,
            detail: {
                proposal_id: p.id,
                title: payload?.title || null,
                club_id: p.club_id ?? null,
                approved_type: approvedType,
                original_type: originalType,
                edited: feedback.edited,
                source_message_id: p.ingested_email_id ?? null,
            },
        });
        res.json({ ok: true });
    } catch (e) {
        if (e.code === 'NO_TARGET') return res.status(400).json({ error: e.message });
        if (e.code === 'FORBIDDEN_TARGET') return res.status(403).json({ error: e.message });
        console.error('publish failed:', e);
        fail(res, 500, 'publish failed', e);
    }
});

// ── GET /ingestion/proposals/:id/event-candidates — live events a PATCH/CANCEL may target ──
router.get('/proposals/:id/event-candidates', userData, async (req, res) => {
    try {
        const p = await EventProposal.findByPk(req.params.id);
        if (!p || !['PATCH_EVENT', 'CANCEL_EVENT'].includes(p.mutation_type)) return res.json({ candidates: [] });
        const scope = await reviewScope(req.user.user_id);
        if (!scope.all && !scope.clubIds.includes(Number(p.club_id))) return res.status(403).json({ error: 'not your club' });
        res.json({ candidates: await eventCandidates(p.payload || {}) });
    } catch (e) { fail(res, 500, 'candidates failed', e); }
});

// ── GET /ingestion/proposals/:id/notice-candidates — live notices a deadline extension may target ──
router.get('/proposals/:id/notice-candidates', userData, async (req, res) => {
    try {
        const p = await EventProposal.findByPk(req.params.id);
        if (!p || p.mutation_type !== 'PATCH_NOTICE') return res.json({ candidates: [] });
        const scope = await reviewScope(req.user.user_id);
        if (!scope.all && !scope.clubIds.includes(Number(p.club_id))) return res.status(403).json({ error: 'not your club' });
        res.json({ candidates: await noticeCandidates(p.payload || {}) });
    } catch (e) { fail(res, 500, 'candidates failed', e); }
});

// ── GET /ingestion/proposals/:id/calendar-candidates — existing entries this may amend ──
router.get('/proposals/:id/calendar-candidates', userData, async (req, res) => {
    try {
        const p = await EventProposal.findByPk(req.params.id);
        if (!p || p.mutation_type !== 'CALENDAR_ENTRY') return res.json({ candidates: [] });
        const scope = await reviewScope(req.user.user_id);
        if (!scope.all && !scope.clubIds.includes(Number(p.club_id))) return res.status(403).json({ error: 'not your club' });
        res.json({ candidates: await calendarCandidates(p.payload || {}) });
    } catch (e) { fail(res, 500, 'candidates failed', e); }
});

// ── POST /ingestion/proposals/:id/dismiss ────────────────────────────────────
router.post('/proposals/:id/dismiss', userData, validateParams(proposalIdParam), async (req, res) => {
    try {
        const p = await EventProposal.findByPk(req.params.id);
        if (!p) return res.status(404).json({ error: 'Not found' });
        const scope = await reviewScope(req.user.user_id);
        if (!scope.all && !scope.clubIds.includes(Number(p.club_id))) return res.status(403).json({ error: 'not your club' });
        const feedback = { original_type: originalTypeOf(p), approved_type: 'dismissed', changed: true, edited: false };
        await p.update({ state: 'dismissed', evidence: { ...(p.evidence || {}), feedback } });
        await recordActivity(req, {
            action: ACTIONS.PROPOSAL_DISMISSED,
            detail: { proposal_id: p.id, title: (p.payload || {}).title || null, club_id: p.club_id ?? null },
        });
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'dismiss failed' }); }
});

// ── Classification overrides (super-admin scoped rules) ──────────────────────
const OVERRIDE_TYPES = ['event', 'opportunity', 'notice', 'calendar'];   // NB no 'dismiss' in v1 (hard drop)

// GET /ingestion/overrides — list all rules (for the review UI). Reviewers only — the rule set reveals
// how classification is steered per sender, so it is not public.
router.get('/overrides', userData, async (req, res) => {
    try {
        const scope = await reviewScope(req.user.user_id);
        if (!scope.all && !scope.clubIds.length) return res.status(403).json({ error: 'reviewers only' });
        res.json({ overrides: await ClassificationOverride.findAll({ order: [['created_at', 'DESC']], raw: true }) });
    }
    catch (e) { fail(res, 500, 'list failed', e); }
});

// GET /ingestion/overrides/preview?sender=&pattern= — retro-match: which of the last 90 days of REAL
// (non-dismissed) emails would this rule have re-typed? The blast-radius check, shown before saving.
// Super-admin only: it echoes back real inbox subject lines for an arbitrary sender (PII / mail-flow leak).
router.get('/overrides/preview', requireSuperAdmin, async (req, res) => {
    try {
        const sender = (req.query.sender || '').toLowerCase().trim();
        const pattern = (req.query.pattern || '').toLowerCase().trim();
        if (!sender) return res.json({ count: 0, samples: [] });
        const since = new Date(Date.now() - 90 * 864e5);
        const rows = await IngestedEmail.findAll({
            where: { from_addr: sender, state: { [require('sequelize').Op.ne]: 'dismissed' }, internal_date: { [require('sequelize').Op.gte]: since } },
            attributes: ['subject'], raw: true, limit: 500,
        });
        const matched = rows.filter((r) => !pattern || (r.subject || '').toLowerCase().includes(pattern));
        res.json({ count: matched.length, total_from_sender: rows.length, samples: matched.slice(0, 8).map((r) => (r.subject || '').slice(0, 80)) });
    } catch (e) { fail(res, 500, 'preview failed', e); }
});

// POST /ingestion/overrides — create a rule (super-admin). Pattern REQUIRED for relay senders.
router.post('/overrides', requireSuperAdmin, validateBody(overrideBody), async (req, res) => {
    try {
        const sender = (req.body.sender || '').toLowerCase().trim();
        const pattern = (req.body.pattern || '').trim() || null;
        const type = req.body.target_type;
        if (!sender || !OVERRIDE_TYPES.includes(type)) return res.status(400).json({ error: 'sender + valid target_type required' });
        if (CFG.relaySenders.includes(sender) && !pattern) {
            return res.status(400).json({ error: 'this is a relay sender (many clubs) — a subject pattern is required so the rule does not blanket everything' });
        }
        const row = await ClassificationOverride.create({ sender_addr: sender, subject_pattern: pattern, target_type: type, created_by: req.superAdminId });
        res.json({ ok: true, override: row });
    } catch (e) { fail(res, 500, 'create failed', e); }
});

// DELETE /ingestion/overrides/:id — retire a rule (super-admin)
router.delete('/overrides/:id', requireSuperAdmin, async (req, res) => {
    try { await ClassificationOverride.destroy({ where: { id: req.params.id } }); res.json({ ok: true }); }
    catch (e) { fail(res, 500, 'delete failed', e); }
});

// ── POST /ingestion/dev-seed — run the pipeline over sample emails & publish ──
// Dev/testing only: populates real events + notices so the UI is demonstrable.
// Prefer a real-email corpus (proves the pipeline generalizes) when present;
// fall back to the hand-written demo samples otherwise.
let SAMPLES;
try { SAMPLES = require('../services/eventIngestion/__tests__/realCorpus.json'); }
catch { SAMPLES = require('../services/eventIngestion/__tests__/sampleEmails'); }
router.post('/dev-seed', requireSuperAdmin, async (req, res) => {
    // Destructive (wipes all notices + email-sourced events) → super-admin AND non-production, fail-closed.
    if (process.env.NODE_ENV !== 'development') return res.status(403).json({ error: 'disabled outside development' });
    try {
        const senderMap = await loadSenderMap();
        const out = { events: 0, notices: 0, calendar: 0, dismissed: 0 };
        const { reviewProposals } = require('../services/eventIngestion/runner');

        // dev-only: clear previously seeded email items so re-seeding doesn't duplicate
        const prior = await Event.findAll({ where: { source: 'email' }, attributes: ['id'], raw: true });
        const priorIds = prior.map((e) => e.id);
        if (priorIds.length) await EventCategoryAlloted.destroy({ where: { event_id: priorIds } });
        await Event.destroy({ where: { source: 'email' } });
        await Notice.destroy({ where: {} });

        for (const email of SAMPLES) {
            const proposals = runPipeline(email, { senderMap });
            await reviewProposals(email, proposals, senderMap, out);   // Groq backstop on uncertain items
            const p = proposals[0];
            if (p.mutation_type === 'CREATE_EVENT') { await publishEvent(p.payload, p.club, email); out.events++; }
            else if (p.mutation_type === 'CREATE_NOTICE') { await publishNotice(p.payload, email); out.notices++; }
            else if (p.mutation_type === 'CALENDAR_ENTRY') out.calendar++;
            else out.dismissed++;
        }
        res.json({ seeded: out });
    } catch (e) {
        console.error('dev-seed failed:', e);
        fail(res, 500, 'dev-seed failed', e);
    }
});

// ── GET /ingestion/drift — per-sender health, to catch silent quality drift ──
// Aggregates existing ingested_email + event_proposal.evidence (no stats table). A sender whose
// dismiss-rate / uncertain-rate / llm-reclassify-rate spikes over time = its conventions changed.
// Super-admin only: it exposes raw sender addresses + per-sender processing analytics (mail-flow leak).
router.get('/drift', requireSuperAdmin, async (req, res) => {
    try {
        const { Op } = require('sequelize');
        const days = Math.min(365, Number(req.query.days) || 30);
        const since = new Date(Date.now() - days * 864e5);
        const emails = await IngestedEmail.findAll({
            where: { internal_date: { [Op.gte]: since } },
            attributes: ['id', 'from_addr', 'state', 'error'], raw: true,
        });
        const senderOf = {};
        const stats = {};
        const S = (s) => (stats[s] = stats[s] || { sender: s, seen: 0, dismissed: 0, reasons: {}, proposals: 0, uncertain: 0, reclassified: 0, decided: 0, type_changed: 0, edited: 0 });
        for (const e of emails) {
            senderOf[e.id] = e.from_addr;
            const st = S(e.from_addr); st.seen++;
            if (e.state === 'dismissed') { st.dismissed++; if (e.error) st.reasons[e.error] = (st.reasons[e.error] || 0) + 1; }
        }
        const ids = Object.keys(senderOf).map(Number);
        if (ids.length) {
            const props = await EventProposal.findAll({
                where: { ingested_email_id: { [Op.in]: ids } },
                attributes: ['ingested_email_id', 'evidence'], raw: true,
            });
            for (const p of props) {
                const sender = senderOf[p.ingested_email_id]; if (!sender) continue;
                const st = S(sender); st.proposals++;
                const ev = p.evidence || {};
                if (ev.uncertain) st.uncertain++;
                if (ev.reclassified) st.reclassified++;
                if (ev.feedback) {   // a human published/dismissed this — the correction signal
                    st.decided++;
                    if (ev.feedback.changed) st.type_changed++;
                    if (ev.feedback.edited) st.edited++;
                }
            }
        }
        const rate = (n, d) => (d ? +(n / d).toFixed(2) : 0);
        const senders = Object.values(stats).map((s) => ({
            sender: s.sender,
            seen: s.seen,
            dismiss_rate: rate(s.dismissed, s.seen),
            uncertain_rate: rate(s.uncertain, s.proposals),
            llm_reclassify_rate: rate(s.reclassified, s.proposals),
            type_change_rate: rate(s.type_changed, s.decided),   // human moved it to a different type
            edit_rate: rate(s.edited, s.decided),                 // human edited fields before publishing
            decided: s.decided,
            top_reasons: Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, c]) => `${r}:${c}`),
        })).sort((a, b) => (b.type_change_rate - a.type_change_rate) || (b.dismiss_rate - a.dismiss_rate) || (b.uncertain_rate - a.uncertain_rate));
        res.json({ window_days: days, total_seen: emails.length, senders });
    } catch (e) {
        console.error('drift failed:', e);
        fail(res, 500, 'drift failed', e);
    }
});

module.exports = router;
