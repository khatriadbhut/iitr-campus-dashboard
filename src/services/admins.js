import api from './api';

const parsePermissions = (rawPermissions) => {
    if (Array.isArray(rawPermissions)) return rawPermissions;
    if (typeof rawPermissions === 'string') {
        try {
            const parsed = JSON.parse(rawPermissions);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
};

const normalizeAdmin = (admin) => ({
    ...admin,
    permissions: parsePermissions(admin?.permissions),
});

const adminsService = {
    getAllAdmins: async () => {
        const response = await api.get('/admins/all');
        const admins = Array.isArray(response.data?.admins) ? response.data.admins : [];
        return admins.map(normalizeAdmin);
    },

    getAdminByUserId: async (userId) => {
        const response = await api.get(`/admins/${userId}`);
        return normalizeAdmin(response.data?.admin || {});
    },

    addAdmin: async (payload) => {
        const response = await api.post('/admins/add', payload);
        return response.data;
    },

    // isSuperAdmin is sent only when the caller passes it, so an ordinary permission edit never
    // touches the flag. The server re-checks the caller's own super-admin status regardless.
    updateAdminPermissions: async (userId, permissionIds, isSuperAdmin) => {
        const response = await api.patch(`/admins/${userId}`, {
            permission_ids: permissionIds,
            ...(isSuperAdmin === undefined ? {} : { is_super_admin: isSuperAdmin }),
        });
        return response.data;
    },

    deleteAdmin: async (userId) => {
        const response = await api.delete(`/admins/${userId}`);
        return response.data;
    },

    getAllAdminPermissions: async () => {
        const response = await api.get('/admin-permissions/all');
        return Array.isArray(response.data?.permissions) ? response.data.permissions : [];
    },
};

export default adminsService;
