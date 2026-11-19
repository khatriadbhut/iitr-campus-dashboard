import api from './api';

/**
 * Server-persisted reminders on NOTICES.
 *
 * The events equivalent is services/reminders.js. These are separate because the backend tables are
 * separate (see database/schemas/noticeReminder.js), and because a notice's moment is a DEADLINE far
 * more often than a start time.
 *
 * Ids here are the bare numeric notice id. The `notice-` prefix used in localStorage exists only to
 * stop eventReminders POSTing a notice id to the events API — it is stripped before it reaches here.
 */
const noticeRemindersService = {
    getAll: async () => {
        const response = await api.get('/notice-reminders');
        return Array.isArray(response.data?.reminders) ? response.data.reminders : [];
    },

    setOffsets: async (noticeId, offsetsMinutes) => {
        const response = await api.put(`/notice-reminders/${noticeId}`, { offsetsMinutes });
        return response.data?.reminder;
    },

    disable: async (noticeId) => {
        await api.delete(`/notice-reminders/${noticeId}`);
    },
};

export default noticeRemindersService;
