const { AdminPermissionAlloted } = require('../../database/schemas');
const { userData } = require('../userAuth');
const { checkClubAdmin } = require('../clubAdminAuth');
const { PERM, permissionId } = require('../../utils/permissions');


/**
 * Middleware to check if user has event category CRUD permission OR is a club admin
 * Uses userData middleware to verify user, then checks admin permission or club admin status
 */
const checkEventCategoryPermission = async (req, res, next) => {
    // First run userData middleware to verify and attach user info
    userData(req, res, async () => {
        try {
            const userId = req.user.user_id;

            const permissionCheck = await AdminPermissionAlloted.findOne({
                where: { user_id: userId, admin_permission_id: permissionId(PERM.EVENT_CATEGORY_CRUD) },
                attributes: ['user_id']
            });

            if (permissionCheck) {
                // User has event category CRUD permission, allow access
                return next();
            }

            // If no event category permission, check if user is club admin
            checkClubAdmin(req, res, next);
        } catch (error) {
            console.error('Permission check error:', error);
            return res.status(500).json({
                error: 'Permission check failed',
                message: 'Could not verify permissions'
            });
        }
    });
};

module.exports = { checkEventCategoryPermission };
