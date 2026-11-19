/**
 * The append-only record of WHO did WHAT, and of anything that looks like an attack.
 *
 * Shares the `privilege_audit` table with recordPrivilegeChange(). One table on purpose: an admin
 * investigating an incident wants a single chronological stream, not three tables to correlate by
 * timestamp. `action` distinguishes the kinds; the analytics endpoint groups on it.
 *
 * WHY THIS EXISTS: until now nothing recorded who approved an event. routes/eventIngestion.js wrote
 * evidence.feedback — WHAT changed — but never req.user.user_id, and `event` has no timestamp column
 * at all. So for everything published before this, both the author and the moment are permanently
 * unrecoverable. Provenance only starts accruing once something writes it down.
 *
 * Never throws and never blocks: failing to log must not fail the operation being logged. Unlike
 * recordPrivilegeChange this does NOT alert Sentry per row — these are routine and would drown the
 * genuine privilege alerts, which are rare and meant to be noticed.
 */
const { Op } = require('sequelize');
const { PrivilegeAudit } = require('../database/schemas');
const logger = require('./logger');

/**
 * How loudly a row should read.
 *
 * URGENT is not "bad thing happened" — it is "a person should look at this now". One mistyped
 * password is not that; two hundred from one address is. Keeping the distinction in the DATA rather
 * than in the reader's head is the whole point: a security log where everything is red is a security
 * log nobody reads, and the genuine incident is the row that gets skipped.
 */
const SEVERITY = Object.freeze({ URGENT: 'urgent', ROUTINE: 'routine' });

// A single failure is somebody fat-fingering their password. This many from one address inside the
// window is a machine, and it changes what the row means.
const BURST_COUNT = 5;
const BURST_WINDOW_MS = 15 * 60 * 1000;

/**
 * The client's real address.
 *
 * CloudFront-Viewer-Address first: it is set by the CDN itself and cannot be spoofed by the caller.
 * X-Forwarded-For is attacker-controlled at the left-hand end, so its FIRST entry is only trusted as
 * a fallback — good enough for a log, never for an authorisation decision.
 */
const clientIp = (req) => (
    (req.headers['cloudfront-viewer-address'] || '').split(':')[0]
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.ip || null
);

/** Actions that represent content moving, i.e. the provenance trail. */
const ACTIONS = Object.freeze({
    EVENT_PUBLISHED: 'event_published',
    NOTICE_PUBLISHED: 'notice_published',
    NOTICE_POSTED_MANUAL: 'notice_posted_manual',
    PROPOSAL_DISMISSED: 'proposal_dismissed',
    CALENDAR_PUBLISHED: 'calendar_published',
    // security
    LOGIN_FAILED: 'login_failed',
    RATE_LIMITED: 'rate_limited',
    FORBIDDEN: 'forbidden',
    ATTACK_ATTEMPT: 'attack_attempt',
});

/**
 * Record an action. Fire-and-forget by design — callers do not await the failure path, and a logging
 * outage degrades to a gap in history rather than a failed publish.
 */
async function recordActivity(req, { action, targetUserId = null, detail = {}, severity = null }) {
    try {
        await PrivilegeAudit.create({
            action,
            actor_user_id: req?.user?.user_id ?? null,
            target_user_id: targetUserId,
            detail,
            ip: clientIp(req),
            severity,
        });
    } catch (e) {
        // Logged, not thrown. The publish already happened; losing its audit row is bad but strictly
        // less bad than telling the admin their approval failed when it did not.
        logger.error({ err: e, action }, 'activity log write failed');
    }
}

/**
 * Security events, kept deliberately coarse.
 *
 * Only the shape of the attempt is stored — never a password, a token, or a request body. An audit
 * table that accumulates secrets becomes the thing worth stealing.
 */
async function recordSecurityEvent(req, { action, detail = {}, severity }) {
    const ip = clientIp(req);
    let level = severity;

    if (!level) {
        // Anything that got as far as tripping a limiter or matching an attack pattern is already a
        // machine at work, so it is urgent on its own. A lone failed login or refusal is not.
        if (action === ACTIONS.ATTACK_ATTEMPT || action === ACTIONS.RATE_LIMITED) {
            level = SEVERITY.URGENT;
        } else {
            level = SEVERITY.ROUTINE;
            // ...unless it is one of many from the same address, which is the difference between a
            // typo and someone working through a password list. Counted at WRITE time so the row
            // carries its own meaning: severity computed at read time would depend on which page you
            // were looking at, and could not be filtered or indexed.
            if (ip && (action === ACTIONS.LOGIN_FAILED || action === ACTIONS.FORBIDDEN)) {
                try {
                    const recent = await PrivilegeAudit.count({
                        where: {
                            ip,
                            action: { [Op.in]: [ACTIONS.LOGIN_FAILED, ACTIONS.FORBIDDEN] },
                            created_at: { [Op.gt]: new Date(Date.now() - BURST_WINDOW_MS) },
                        },
                    });
                    if (recent + 1 >= BURST_COUNT) level = SEVERITY.URGENT;
                } catch { /* if the count fails, log it as routine rather than not at all */ }
            }
        }
    }

    return recordActivity(req, {
        action, severity: level,
        detail: { path: req?.path, method: req?.method, ...detail },
    });
}

module.exports = { recordActivity, recordSecurityEvent, clientIp, ACTIONS, SEVERITY, BURST_COUNT };
