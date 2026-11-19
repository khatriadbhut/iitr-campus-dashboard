const { AdminPermissionAlloted, Event } = require('../../database/schemas');
const { userData } = require('../userAuth');
const { checkClubAdminForClub } = require('../clubAdminAuth');
const { PERM, permissionId } = require('../../utils/permissions');


/**
 * Middleware to check if user has event CRUD permission OR is club admin of the event's club
 * Uses userData middleware to verify user, then checks admin permission or club admin status
 */
const checkEventPermission = async (req, res, next) => {
    // First run userData middleware to verify and attach user info
    userData(req, res, async () => {
        try {
            const userId = req.user.user_id;

            const permissionCheck = await AdminPermissionAlloted.findOne({
                where: { user_id: userId, admin_permission_id: permissionId(PERM.EVENT_CRUD) },
                attributes: ['user_id']
            });

            if (permissionCheck) {
                // User has event CRUD permission, allow access
                return next();
            }

            // If no event permission, check if user is club admin for this event's club
            const { eventId } = req.params;

            if (eventId) {
                // Get the club_id for this event
                const event = await Event.findOne({
                    where: { id: eventId },
                    attributes: ['club_id']
                });

                if (event) {
                    // Set club_id in req.body for checkClubAdminForClub middleware
                    req.body.club_id = event.club_id;
                }
            }

            // Check if user is admin of this club
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

module.exports = { checkEventPermission };
