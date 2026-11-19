const { AdminPermissionAlloted } = require('../../database/schemas');
const { userData } = require('../userAuth');
const { checkClubAdminForClub } = require('../clubAdminAuth');
const { PERM, permissionId } = require('../../utils/permissions');


/**
 * Middleware to check if user has manage club admins permission OR is club admin of provided club_id
 * Uses userData middleware to verify user, then checks admin permission or club admin status
 */
const checkManageClubAdminsPermission = async (req, res, next) => {
    // First run userData middleware to verify and attach user info
    userData(req, res, async () => {
        try {
            const userId = req.user.user_id;

            const permissionCheck = await AdminPermissionAlloted.findOne({
                where: { user_id: userId, admin_permission_id: permissionId(PERM.MANAGE_CLUB_ADMINS) },
                attributes: ['user_id']
            });

            if (permissionCheck) {
                // User has manage club admins permission, allow access
                return next();
            }

            // If no manage club admins permission, check if user is admin of this club
            checkClubAdminForClub(req, res, next);
        } catch (error) {
            console.error('Permission check error:', error);
            return res.status(500).json({
                error: 'Permission check failed',
                message: 'Could not verify permissions'
            });
        }
    });
};

module.exports = { checkManageClubAdminsPermission };
