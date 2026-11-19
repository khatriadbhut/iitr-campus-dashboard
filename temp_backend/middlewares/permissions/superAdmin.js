const { User } = require('../../database/schemas');
const { userData } = require('../userAuth');

/**
 * SUPER ADMIN — the only role that may hand out rights.
 *
 * WHY A COLUMN AND NOT A PERMISSION
 * Every other right lives in admin_permission, and that is exactly why "super admin" could not. A
 * permission is grantable, so if super-admin status were one, anyone able to grant permissions could
 * mint another super admin — the power to grant would be the power to create grantors, and no gate
 * can close that loop. `user.is_super_admin` sits outside the grantable set, so the loop is broken by
 * construction rather than by a check someone has to remember.
 *
 * The codebase previously disagreed with itself about what a super admin even was:
 * routes/eventIngestion.js treated `manage_club_admins` as the marker, while /admins/* effectively
 * treated `manage_admins` as it. Neither was written down anywhere. This is now the single answer.
 *
 * WHAT MAKES IT HOLD
 *   · Read from the DATABASE on every gated request — never from the JWT. A token minted before a
 *     demotion carries no authority, so revoking someone bites on their next call rather than
 *     whenever their session happens to expire.
 *   · Settable through exactly ONE route (PATCH /admins/:userId, itself behind this gate). The OAuth
 *     upsert, the preferences PATCH and the admin-create path all leave the column alone, so there is
 *     no mass-assignment route into it.
 *   · Fails CLOSED. No user row, no session, or a database error all end in a refusal.
 *
 * WHAT IT DOES NOT DO — worth stating plainly rather than implying otherwise: this closes escalation
 * *through the application*. A super admin's own session is now the boundary, and anyone who takes
 * over such a session, or who has direct database access, is inside it. That is a deliberate trade
 * for being able to appoint super admins from the admin panel.
 */
const requireSuperAdmin = async (req, res, next) => {
    userData(req, res, async () => {
        try {
            const row = await User.findByPk(req.user.user_id, { attributes: ['is_super_admin'] });

            if (!row || row.is_super_admin !== true) {
                return res.status(403).json({
                    error: 'Permission denied',
                    message: 'Only a super admin can change who has access.',
                });
            }

            req.isSuperAdmin = true;
            next();
        } catch (error) {
            console.error('Super admin check error:', error);
            // Fail closed: a lookup that errored tells us nothing, and "unknown" must never mean "yes".
            return res.status(500).json({
                error: 'Permission check failed',
                message: 'Could not verify permissions',
            });
        }
    });
};

/** Non-blocking read, for routes that only need to VARY on it (e.g. what the UI is allowed to show). */
const isSuperAdmin = async (userId) => {
    if (!userId) return false;
    const row = await User.findByPk(userId, { attributes: ['is_super_admin'] });
    return row?.is_super_admin === true;
};

module.exports = { requireSuperAdmin, isSuperAdmin };
