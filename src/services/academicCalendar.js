import api from './api';

const academicCalendarService = {
    /** All academic calendar events for the current (or a specific) semester. */
    getAllEvents: async (semester) => {
        try {
            const response = await api.get('/academic-calendar', {
                params: semester ? { semester } : undefined,
            });
            return response.data.data;
        } catch (error) {
            console.error('Error fetching academic calendar:', error);
            throw error;
        }
    },

    /**
     * The teaching-day totals the uploaded calendar PDF states about itself, or null when that
     * semester's layout yielded none. Deliberately a separate call rather than a second return value
     * from getAllEvents, so nothing that already consumes the entries has to change shape.
     * `{ others, ugFirstYear }` — the two differ because UG I year starts later.
     */
    getTeachingDays: async (semester) => {
        try {
            const response = await api.get('/academic-calendar', {
                params: semester ? { semester } : undefined,
            });
            return response.data.teachingDays || null;
        } catch {
            return null;   // a missing figure hides a tile; it must never break the calendar
        }
    },

    /** A specific academic calendar event by its id. */
    getEventById: async (id) => {
        try {
            const response = await api.get(`/academic-calendar/${id}`);
            return response.data;
        } catch (error) {
            console.error(`Error fetching academic calendar event ${id}:`, error);
            throw error;
        }
    },

    /** Semesters available to view (past / current / upcoming). */
    getSemesters: async () => {
        const response = await api.get('/academic-calendar/semesters');
        return response.data.data;
    },

    /**
     * Admin: upload a PDF and get the parsed preview (nothing is saved yet).
     * Resolves to the report `{ status, entries?, flags?, warnings?, coverage?, meta?, message? }`.
     * A 4xx with a `status`/`message` (coming_soon / no_text / unrecognized) is returned as data.
     */
    previewImport: async (file) => {
        const form = new FormData();
        form.append('file', file);
        try {
            const response = await api.post('/academic-calendar/import/preview', form, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            return response.data;
        } catch (error) {
            // Surface the structured non-ok outcomes to the UI instead of throwing.
            if (error.response && error.response.data && error.response.data.status) {
                return error.response.data;
            }
            throw error;
        }
    },

    /** Admin: publish the reviewed calendar (atomic replace-by-semester). */
    commitImport: async (payload) => {
        const response = await api.post('/academic-calendar/import/commit', payload);
        return response.data;
    },

    /** Admin: import history for the rollback UI. */
    getImports: async () => {
        const response = await api.get('/academic-calendar/imports');
        return response.data.data;
    },

    /**
     * Admin: the current published calendar in editable form. With no argument it
     * returns the latest-served calendar (for "Edit current calendar"); pass a
     * semester to fetch that specific published calendar (used by the re-upload
     * diff to compare against the same semester). Throws 404 if none exists yet.
     */
    getCurrentForEdit: async (semester) => {
        const response = await api.get('/academic-calendar/current', {
            params: semester ? { semester } : undefined,
        });
        return response.data;
    },

    /** Admin: revert to a previous import's snapshot. */
    rollback: async (importId) => {
        const response = await api.post(`/academic-calendar/import/${importId}/rollback`);
        return response.data;
    },
};

export default academicCalendarService;
