/**
 * Record a privilege change and raise an alert.
 *
 * Two outputs on purpose:
 *   - a DB row, so there is a durable trail to reconstruct WHO granted WHAT and unwind it
 *   - a Sentry event, so someone finds out WITHOUT having to go looking
 *
 * The alert is the point. With a small admin team, an unexpected "X granted admin to Y" landing in the
 * shared inbox is immediately recognisable as wrong; a log nobody reads is not a control.
 *
 * Never throws and never blocks the request: failing to audit must not fail the operation the admin
 * actually asked for. A failure here is itself reported to Sentry so the gap is visible.
 */
const { PrivilegeAudit } = require('../database/schemas');
const sentry = require('./sentry');
const logger = require('./logger');

const clientIp = (req) => (
    (req.headers['cloudfront-viewer-address'] || '').split(':')[0]
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.ip || null
);

async function recordPrivilegeChange(req, { action, targetUserId, detail = {} }) {
    const actorUserId = req?.user?.user_id ?? null;
    // Handing someone super admin is the most consequential thing any route in this app can do, and
    // unlike an attack it arrives from a trusted session — so nothing else will make it stand out.
    // It is marked urgent for the same reason it is alerted to Sentry: it must not need looking for.
    const severity = detail?.is_super_admin === true ? 'urgent' : null;
    try {
        await PrivilegeAudit.create({
            action,
            actor_user_id: actorUserId ?? null,
            target_user_id: targetUserId ?? null,
            detail,
            ip: clientIp(req),
            severity,
        });
    } catch (e) {
        logger.error({ err: e, action, actorUserId, targetUserId }, 'privilege audit write FAILED');
        sentry.captureException(e, { tags: { area: 'privilege-audit' }, extra: { action, actorUserId, targetUserId } });
    }

    // Alert regardless of whether the row landed — a missing DB write must not also mean silence.
    try {
        sentry.captureMessage(
            `privilege: ${action} — actor ${actorUserId} → target ${targetUserId}`,
            { level: 'warning', tags: { area: 'privilege-audit', action }, extra: { detail, ip: clientIp(req) } },
        );
    } catch { /* alerting must never break the request */ }

    logger.warn({ action, actorUserId, targetUserId, detail }, 'privilege change');
}

module.exports = { recordPrivilegeChange };
