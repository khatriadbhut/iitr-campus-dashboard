const express = require('express');
const { Op } = require('sequelize');
const router = express.Router();
const { User, AdminPermission, AdminPermissionAlloted, sequelize } = require('../database/schemas');
const { checkManageAdminsPermission } = require('../middlewares/permissions/manageAdmins');
// Granting rights is SUPER-ADMIN ONLY. `manage_admins` used to gate these writes, but that
// permission is itself grantable through them — so anyone holding it could mint more holders,
// and "super admin" had no stable meaning. Reads stay on manage_admins so the panel still loads
// for ordinary admins; only the writes moved.
const { requireSuperAdmin } = require('../middlewares/permissions/superAdmin');
const { recordPrivilegeChange } = require('../utils/privilegeAudit');
const { Joi, validateBody, validateParams, id, idList } = require('../middlewares/validate');

// Schemas for the highest-privilege endpoints in the app: these grant and revoke institute admin.
// stripUnknown means an extra field in the JSON is dropped, never forwarded into a model write.
const userIdParam = Joi.object({ userId: id.required() });
// `is_super_admin` is listed EXPLICITLY here and nowhere else in the app. stripUnknown drops any field
// a schema does not name, so this is the only shape in which the flag can reach a model write at all —
// the OAuth upsert, the preferences PATCH and every other route silently discard it.
const updateAdminBody = Joi.object({
    permission_ids: idList.required(),
    is_super_admin: Joi.boolean(),
});
const addAdminBody = Joi.object({
    user_id: id,
    enrolment_number: Joi.string().trim().max(32),
    permission_ids: idList.required(),
    is_super_admin: Joi.boolean(),
}).or('user_id', 'enrolment_number');            // one of the two must identify the target


const formatAdminWithPermissions = (userRecord) => {
    if (!userRecord) return null;

    const permissions = Array.isArray(userRecord.AdminPermissions)
        ? userRecord.AdminPermissions.map((permission) => ({
            id: permission.id,
            name: permission.name,
        }))
        : [];

    return {
        user_id: userRecord.user_id,
        full_name: userRecord.full_name,
        email: userRecord.email,
        enrolment_number: userRecord.enrolment_number,
        is_super_admin: userRecord.is_super_admin === true,
        permissions,
    };
};

// Protected route to get all admins with their permissions
router.get('/all', checkManageAdminsPermission, async (req, res) => {
    try {
        const adminRows = await User.findAll({
            attributes: ['user_id', 'full_name', 'email', 'enrolment_number', 'is_super_admin'],
            include: [
                {
                    model: AdminPermission,
                    attributes: ['id', 'name'],
                    through: {
                        model: AdminPermissionAlloted,
                        attributes: [],
                    },
                    // Was `required: true`, an INNER JOIN — so "admin" meant "holds at least one of the
                    // six grantable permissions". A super admin given no grantable permissions is still
                    // very much an admin, and would have vanished from this list entirely: invisible in
                    // the panel, unrevokable through the UI, discoverable only in the database. Left
                    // join instead, and filter below.
                    required: false,
                },
            ],
            order: [['full_name', 'ASC']],
        });

        const admins = adminRows
            .filter((u) => u.is_super_admin === true || (u.AdminPermissions || []).length > 0)
            .map(formatAdminWithPermissions);

        res.json({ admins });
    } catch (error) {
        console.error('Error fetching admins:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch admins'
        });
    }
});

// Protected route to get a specific admin with permissions
router.get('/:userId', checkManageAdminsPermission, async (req, res) => {
    const { userId } = req.params;

    try {
        const admin = await User.findByPk(userId, {
            attributes: ['user_id', 'full_name', 'email', 'enrolment_number', 'is_super_admin'],
            include: [
                {
                    model: AdminPermission,
                    attributes: ['id', 'name'],
                    through: {
                        model: AdminPermissionAlloted,
                        attributes: [],
                    },
                    required: false,
                },
            ],
        });

        if (!admin) {
            return res.status(404).json({
                error: 'Not found',
                message: 'Admin not found'
            });
        }

        res.json({ admin: formatAdminWithPermissions(admin) });
    } catch (error) {
        console.error('Error fetching admin:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch admin'
        });
    }
});

// Protected route to update an admin's permissions
router.patch('/:userId', requireSuperAdmin, validateParams(userIdParam), validateBody(updateAdminBody), async (req, res) => {
    const { userId } = req.params;
    const { permission_ids, is_super_admin } = req.body;

    try {
        if (!Array.isArray(permission_ids)) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'permission_ids must be an array'
            });
        }

        // ── Lockout guards ───────────────────────────────────────────────────────────────────────
        // Super-admin status can only be set from here, so this is also the only place it can be
        // REMOVED — which makes it the only place the team can lock itself out. Two refusals:
        //
        //   1. You cannot demote yourself. Not paternalism: a super admin who unticks their own box
        //      loses the very right needed to undo it, and if they were the last one the app has no
        //      route back at all — recovery would mean SSH and SQL.
        //   2. The last super admin cannot be removed. Same reasoning, one step out: revoking anyone
        //      else is fine while a second remains.
        const demoting = is_super_admin === false;
        if (demoting && String(userId) === String(req.user.user_id)) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'You cannot remove your own super admin access. Ask another super admin.',
            });
        }
        if (demoting) {
            const remaining = await User.count({ where: { is_super_admin: true, user_id: { [Op.ne]: userId } } });
            if (remaining === 0) {
                return res.status(400).json({
                    error: 'Bad request',
                    message: 'This is the last super admin. Appoint another one first.',
                });
            }
        }

        await sequelize.transaction(async (t) => {
            if (is_super_admin !== undefined) {
                await User.update({ is_super_admin }, { where: { user_id: userId }, transaction: t });
            }
            // Delete existing permissions
            await AdminPermissionAlloted.destroy({
                where: { user_id: userId },
                transaction: t
            });

            // Add new permissions
            if (permission_ids.length > 0) {
                const permissionData = permission_ids.map(id => ({
                    user_id: userId,
                    admin_permission_id: id
                }));
                await AdminPermissionAlloted.bulkCreate(permissionData, { transaction: t });
            }
        });

        await recordPrivilegeChange(req, {
            action: 'update_admin', targetUserId: userId,
            // Record the super-admin change explicitly. It is the single most consequential thing this
            // route can do and it is invisible in permission_ids, which only covers the six grantables.
            detail: { permission_ids, ...(is_super_admin !== undefined ? { is_super_admin } : {}) },
        });

        res.json({
            message: 'Admin permissions updated successfully'
        });
    } catch (error) {
        console.error('Error updating admin permissions:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not update admin permissions'
        });
    }
});

// Protected route to add a new admin with permissions
router.post('/add', requireSuperAdmin, validateBody(addAdminBody), async (req, res) => {
    const { user_id, enrolment_number, permission_ids, is_super_admin } = req.body;

    try {
        if ((!user_id && !enrolment_number) || !Array.isArray(permission_ids)) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'enrolment_number or user_id and permission_ids are required'
            });
        }

        const existingUser = user_id
            ? await User.findByPk(user_id, { attributes: ['user_id'] })
            : await User.findOne({
                where: { enrolment_number: String(enrolment_number).trim() },
                attributes: ['user_id']
            });

        if (!existingUser) {
            return res.status(404).json({
                error: 'Not found',
                message: 'User not found'
            });
        }

        const existingAdmin = await AdminPermissionAlloted.findOne({
            where: { user_id: existingUser.user_id }
        });

        if (existingAdmin) {
            return res.status(409).json({
                error: 'Conflict',
                message: 'User is already an admin'
            });
        }

        await sequelize.transaction(async (t) => {
            // Only ever SET here, never cleared: this route creates an admin, and revoking is the
            // PATCH's job. `=== true` so a truthy string in the JSON cannot promote anyone.
            if (is_super_admin === true) {
                await User.update({ is_super_admin: true }, { where: { user_id: existingUser.user_id }, transaction: t });
            }
            if (permission_ids.length > 0) {
                const permissionData = permission_ids.map(id => ({
                    user_id: existingUser.user_id,
                    admin_permission_id: id
                }));
                await AdminPermissionAlloted.bulkCreate(permissionData, { transaction: t });
            }
        });

        await recordPrivilegeChange(req, {
            action: 'grant_admin', targetUserId: existingUser?.user_id ?? user_id ?? null,
            detail: { permission_ids, enrolment_number: enrolment_number || null, is_super_admin: is_super_admin === true },
        });

        res.status(201).json({
            message: 'Admin created successfully'
        });
    } catch (error) {
        console.error('Error creating admin:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not create admin'
        });
    }
});

// Protected route to delete an admin (remove all permissions)
router.delete('/:userId', requireSuperAdmin, validateParams(userIdParam), async (req, res) => {
    const { userId } = req.params;

    try {
        if (String(userId) === String(req.user.user_id)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You cannot remove your own admin permissions'
            });
        }

        const result = await AdminPermissionAlloted.destroy({
            where: { user_id: userId }
        });

        if (result === 0) {
            return res.status(404).json({
                error: 'Not found',
                message: 'Admin not found'
            });
        }

        await recordPrivilegeChange(req, {
            action: 'revoke_admin', targetUserId: req.params.userId,
            detail: { rows_removed: result },
        });

        res.json({
            message: 'Admin removed successfully',
            user_id: userId
        });
    } catch (error) {
        console.error('Error deleting admin:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not delete admin'
        });
    }
});

module.exports = router;
