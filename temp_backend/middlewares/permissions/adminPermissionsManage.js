const { AdminPermissionAlloted } = require('../../database/schemas');
const { userData } = require('../userAuth');
const { PERM, permissionId } = require('../../utils/permissions');

/**
 * Gate for the routes that edit the PERMISSION DEFINITIONS themselves — renaming or deleting a row in
 * admin_permission. That is the most consequential thing in the admin surface: a delete cascades
 * through admin_permission_alloted and strips that right from every admin who held it, including
 * whoever pressed the button.
 *
 * This file was the last one still comparing a raw id from an env var:
 *
 *     const ADMIN_PERMISSIONS_MANAGE_ID = process.env.ADMIN_PERMISSIONS_MANAGE_ID || 6;
 *
 * `ADMIN_PERMISSIONS_MANAGE_ID` is set nowhere — not in .env.example, not on the production box — so
 * it always fell through to 6, and 6 is `manage_clubs`. There is no `admin_permissions_manage` row;
 * the table holds exactly six and none of them is this. The lock on the permission table was
 * therefore keyed to the mildest right on the list, the one you would hand a club coordinator.
 *
 * It was wrong rather than dangerous, and worth saying why so nobody re-raises it as a breach:
 *   · the frontend calls only GET /admin-permissions/all — there is no UI for the writes at all
 *   · a CLUB ADMIN (the club_admin table) is a different thing entirely and grants nothing here;
 *     this reads admin_permission_alloted only
 *   · the check fails CLOSED — with a permission row gone the lookup finds nothing and returns 403,
 *     so the failure mode is lockout, never elevation
 *   · in practice every current admin holds all six, so nobody has held the mismatched key alone
 *
 * Now resolved by NAME via utils/permissions, like every other middleware: manage_admins, which is
 * what "may change what admins can do" has always meant. See that module for why ids never belonged
 * in env vars — they come from insertion order and a rebuilt database renumbers them.
 */
const checkAdminPermissionsManage = async (req, res, next) => {
    // First run userData middleware to verify and attach user info
    userData(req, res, async () => {
        try {
            const userId = req.user.user_id;

            const permissionCheck = await AdminPermissionAlloted.findOne({
                where: { user_id: userId, admin_permission_id: permissionId(PERM.MANAGE_ADMINS) },
                attributes: ['user_id']
            });

            if (!permissionCheck) {
                return res.status(403).json({
                    error: 'Permission denied',
                    message: 'You do not have permission to perform this action'
                });
            }

            next();
        } catch (error) {
            console.error('Permission check error:', error);
            return res.status(500).json({
                error: 'Permission check failed',
                message: 'Could not verify permissions'
            });
        }
    });
};

module.exports = { checkAdminPermissionsManage };
