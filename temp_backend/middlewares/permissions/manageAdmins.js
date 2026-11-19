const { AdminPermissionAlloted } = require('../../database/schemas');
const { userData } = require('../userAuth');
const { checkClubAdmin } = require('../clubAdminAuth');
const { PERM, permissionId } = require('../../utils/permissions');


/**
 * Middleware to check if user has manage admins permission OR is a club admin
 * Uses userData middleware to verify user, then checks admin permission or club admin status
 */
const checkManageAdminsPermission = async (req, res, next) => {
    // First run userData middleware to verify and attach user info
    userData(req, res, async () => {
        try {
            const userId = req.user.user_id;

            const permissionCheck = await AdminPermissionAlloted.findOne({
                where: { user_id: userId, admin_permission_id: permissionId(PERM.MANAGE_ADMINS) },
                attributes: ['user_id']
            });

            if (permissionCheck) {
                // User has manage admins permission, allow access
                return next();
            }

            // If no manage admins permission return unauthorized
            return res.status(403).json({
                error: 'Unauthorized',
                message: 'You do not have permission to manage admins'
            });
        } catch (error) {
            console.error('Permission check error:', error);
            return res.status(500).json({
                error: 'Permission check failed',
                message: 'Could not verify permissions'
            });
        }
    });
};

module.exports = { checkManageAdminsPermission };
