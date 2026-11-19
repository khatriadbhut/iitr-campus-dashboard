const { AdminPermissionAlloted } = require('../../database/schemas');
const { userData } = require('../userAuth');
const { checkClubAdmin } = require('../clubAdminAuth');
const { PERM, permissionId } = require('../../utils/permissions');


/**
 * Middleware to check if user has location CRUD permission OR is a club admin
 * Uses userData middleware to verify user, then checks admin permission or club admin status
 */
const checkLocationPermission = async (req, res, next) => {
    // First run userData middleware to verify and attach user info
    userData(req, res, async () => {
        try {
            const userId = req.user.user_id;

            const permissionCheck = await AdminPermissionAlloted.findOne({
                where: { user_id: userId, admin_permission_id: permissionId(PERM.LOCATION_CRUD) },
                attributes: ['user_id']
            });

            if (permissionCheck) {
                // User has location CRUD permission, allow access
                return next();
            }

            // If no location permission, check if user is club admin
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

module.exports = { checkLocationPermission };
