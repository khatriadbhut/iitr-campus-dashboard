const { AdminPermissionAlloted, AdminPermission } = require('../../database/schemas');
const { userData } = require('../userAuth');

const normalize = (n) => String(n || '').trim().toLowerCase().replace(/[\s-]+/g, '_');

// The academic calendar is institution-wide, so it's gated to SUPER ADMINS ONLY —
// holders of the `manage_admins` permission. Regular admins and club admins cannot
// touch it (they must not overwrite the shared institute calendar).
const ALLOWED = new Set(['manage_admins']);

const checkAcademicCalendarPermission = async (req, res, next) => {
    userData(req, res, async () => {
        try {
            const userId = req.user.user_id;
            const alloted = await AdminPermissionAlloted.findAll({
                where: { user_id: userId },
                attributes: ['admin_permission_id'],
            });
            const ids = alloted.map((r) => Number(r.admin_permission_id));
            if (ids.length === 0) return deny(res);

            const perms = await AdminPermission.findAll({ where: { id: ids }, attributes: ['name'] });
            const ok = perms.some((p) => ALLOWED.has(normalize(p.name)));
            return ok ? next() : deny(res);
        } catch (error) {
            console.error('Academic calendar permission check error:', error);
            return res.status(500).json({
                error: 'Permission check failed',
                message: 'Could not verify permissions',
            });
        }
    });
};

function deny(res) {
    return res.status(403).json({
        error: 'Unauthorized',
        message: 'You do not have permission to manage the academic calendar',
    });
}

module.exports = { checkAcademicCalendarPermission };
