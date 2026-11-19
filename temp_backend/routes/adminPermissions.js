const express = require('express');
const router = express.Router();
// const sql = require('../database/connection');
const { AdminPermission } = require('../database/schemas')
const { checkAdminPermissionsManage } = require('../middlewares/permissions/adminPermissionsManage');
// Editing the permission DEFINITIONS is super-admin only — a delete cascades and strips that right
// from every admin holding it.
const { requireSuperAdmin } = require('../middlewares/permissions/superAdmin');
const { Joi, validateBody, validateParams, id } = require('../middlewares/validate');
const permissionBody = Joi.object({ name: Joi.string().trim().max(200).required() });
const permissionIdParam = Joi.object({ permissionId: id.required() });


// These edit the PERMISSION DEFINITIONS, not who holds them. Deleting a row cascades through
// admin_permission_alloted and strips that right from every admin who had it — including whoever
// pressed the button — and there is no route to put it back. Treat with care.
//
// Gated on manage_admins. It used to be gated on an env var that is set nowhere, which fell through
// to id 6 = `manage_clubs`; see middlewares/permissions/adminPermissionsManage.js for the whole story.
//
// NB the old comment here said these were "not linked anywhere in the frontend". That is no longer
// true: src/services/admins.js calls GET /all to populate the permission tick-boxes on the Add Admin
// form. The two READS are used; the PATCH and DELETE still have no UI and no caller.

// Protected route to get all admin permissions
router.get('/all', checkAdminPermissionsManage, async (req, res) => {
    try {
        // const permissions = await sql`
        //     SELECT id, name
        //     FROM admin_permission
        //     ORDER BY id ASC
        // `;

        const permissions = await AdminPermission.findAll({
            attributes: ['id', 'name'],
            order: [['id', 'ASC']]
        });

        res.json({ permissions });
    } catch (error) {
        console.error('Error fetching permissions:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch permissions'
        });
    }
});

// Protected route to get a specific admin permission by ID
router.get('/:permissionId', checkAdminPermissionsManage, async (req, res) => {
    const { permissionId } = req.params;

    try {
        // const permissions = await sql`
        //     SELECT id, name
        //     FROM admin_permission
        //     WHERE id = ${permissionId}
        // `;

        // if (!permissions || permissions.length === 0) {
        //     return res.status(404).json({
        //         error: 'Not found',
        //         message: 'Permission not found'
        //     });
        // }

        // res.json({ permission: permissions[0] });

        const permission = await AdminPermission.findByPk(permissionId, {
            attributes: ['id', 'name']
        });

        if (!permission) {
            return res.status(404).json({
                error: 'Not found',
                message: 'Permission not found'
            });
        }

        res.json({ permission });
    } catch (error) {
        console.error('Error fetching permission:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch permission'
        });
    }
});

// Protected route to update an admin permission by ID
router.patch('/:permissionId', requireSuperAdmin, validateParams(permissionIdParam), validateBody(permissionBody), async (req, res) => {
    const { permissionId } = req.params;
    const { name } = req.body;

    try {
        if (!name) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'Missing required field: name'
            });
        }

        // const result = await sql`
        //     UPDATE admin_permission
        //     SET name = ${name}
        //     WHERE id = ${permissionId}
        //     RETURNING *
        // `;

        // if (!result || result.length === 0) {
        //     return res.status(404).json({
        //         error: 'Not found',
        //         message: 'Permission not found'
        //     });
        // }

        // res.json({
        //     message: 'Permission updated successfully',
        //     permission: result[0]
        // });

        const [updatedRows, [updatedPermission]] = await AdminPermission.update(
            { name },
            {
                where: { id: permissionId },
                returning: true
            }
        );

        if (updatedRows === 0) {
            return res.status(404).json({
                error: 'Not found',
                message: 'Permission not found'
            });
        }

        res.json({
            message: 'Permission updated successfully',
            permission: updatedPermission
        });
    } catch (error) {
        console.error('Error updating permission:', error);

        // if (error.code === '23505') {
        if (error.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({
                error: 'Conflict',
                message: 'A permission with this name already exists'
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not update permission'
        });
    }
});

// Protected route to delete an admin permission by ID
router.delete('/:permissionId', requireSuperAdmin, async (req, res) => {
    const { permissionId } = req.params;

    try {
        // const result = await sql`
        //     DELETE FROM admin_permission
        //     WHERE id = ${permissionId}
        //     RETURNING id
        // `;

        // if (!result || result.length === 0) {

        const result = await AdminPermission.destroy({
            where: { id: permissionId }
        });

        if (result === 0) {
            return res.status(404).json({
                error: 'Not found',
                message: 'Permission not found'
            });
        }

        res.json({
            message: 'Permission deleted successfully',
            permissionId: permissionId
            // permissionId: result[0].id
        });
    } catch (error) {
        console.error('Error deleting permission:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not delete permission'
        });
    }
});

module.exports = router;
