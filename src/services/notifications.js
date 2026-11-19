import api from './api';

/**
 * The notification CENTRE — delivered items and per-account preferences.
 *
 * Not to be confused with services/notify.js, which is the toast helper (a verb; this is a noun).
 * Nothing here touches the browser Notification API: in Phase 1 the backend only fills an inbox,
 * and device delivery arrives with the service worker in Phase 2.
 */
const notificationsService = {
    /** Newest first, plus the unread count the navbar bell renders. */
    list: async () => {
        const response = await api.get('/notifications');
        return {
            notifications: Array.isArray(response.data?.notifications) ? response.data.notifications : [],
            unread: Number(response.data?.unread) || 0,
        };
    },

    /** Marks the given ids read, or everything when called with no argument. */
    markRead: async (ids) => {
        const body = Array.isArray(ids) && ids.length ? { ids } : {};
        const response = await api.post('/notifications/read', body);
        return Number(response.data?.updated) || 0;
    },

    /**
     * Preferences plus `canReview` — whether this user has any review scope at all. The Review Queue
     * section is hidden entirely when false, rather than shown disabled: a student has no use for a
     * toggle that controls something which will never fire for them.
     */
    getPrefs: async () => {
        const response = await api.get('/notifications/prefs');
        return { prefs: response.data?.prefs || null, canReview: !!response.data?.canReview };
    },

    savePrefs: async (patch) => {
        const response = await api.put('/notifications/prefs', patch);
        return response.data?.prefs || null;
    },
};

export default notificationsService;
