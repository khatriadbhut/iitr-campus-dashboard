const { AdminPermissionAlloted, ClubAdmin } = require('../database/schemas');
const { permissionId, PERM } = require('./permissions');

/**
 * Who may review which proposals: `{ all: true }` for a global reviewer, else the club ids they
 * administer. Extracted from routes/eventIngestion.js so the review QUEUE and the notifications
 * ABOUT that queue resolve scope through the same code — two copies would drift, and the failure
 * would be silent: an admin notified about an item they cannot open, or never notified about one
 * that is waiting for them.
 *
 * EVENT_CRUD or MANAGE_CLUB_ADMINS both grant global scope, matching the queue's existing behaviour.
 */
async function reviewScope(userId) {
    const [globalPerm, superPerm, clubRows] = await Promise.all([
        AdminPermissionAlloted.findOne({ where: { user_id: userId, admin_permission_id: permissionId(PERM.EVENT_CRUD) } }),
        AdminPermissionAlloted.findOne({ where: { user_id: userId, admin_permission_id: permissionId(PERM.MANAGE_CLUB_ADMINS) } }),
        ClubAdmin.findAll({ where: { user_id: userId }, attributes: ['club_id'], raw: true }),
    ]);
    if (globalPerm || superPerm) return { all: true, clubIds: [] };
    return { all: false, clubIds: clubRows.map((r) => Number(r.club_id)) };
}

module.exports = { reviewScope };
