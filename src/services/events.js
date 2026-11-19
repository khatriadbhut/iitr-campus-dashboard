import api from './api';

const normalizeSingleEvent = (event) => {
    if (!event) return null;

    const categoriesArray = Array.isArray(event.categories)
        ? event.categories
        : (Array.isArray(event.EventCategories) ? event.EventCategories : []);

    const categoryNames = categoriesArray
        .map((cat) => (typeof cat === 'string' ? cat : cat?.name))
        .filter(Boolean);

    return {
        ...event,
        club_name:
            event.club_name
            || event['Club.club_name']
            || event.Club?.club_name
            || event.Club?.name
            || null,
        location_name:
            event.location_name
            || event['Location.location_name']
            || event.Location?.location_name
            || event.Location?.name
            || null,
        location_description:
            event.location_description
            || event['Location.location_description']
            || event.Location?.location_description
            || event.Location?.description
            || null,
        location_id:
            event.location_id
            || event['Location.location_id']
            || event.Location?.location_id
            || event.Location?.id
            || null,
        categories:
            typeof event.categories === 'string'
                ? event.categories
                : categoryNames,
        category_ids: Array.isArray(event.category_ids)
            ? event.category_ids
            : categoriesArray.map((cat) => Number(cat?.id)).filter((id) => Number.isInteger(id)),
    };
};

const normalizeListEvent = (event) => {
    if (!event) return null;

    return {
        ...event,
        club_name:
            event.club_name
            || event['Club.club_name']
            || event.Club?.club_name
            || event.Club?.name
            || null,
        location_name:
            event.location_name
            || event['Location.location_name']
            || event.Location?.location_name
            || event.Location?.name
            || null,
        location_description:
            event.location_description
            || event['Location.location_description']
            || event.Location?.location_description
            || event.Location?.description
            || null,
        location_id:
            event.location_id
            || event['Location.location_id']
            || event.Location?.location_id
            || event.Location?.id
            || null,
        club_id:
            event.club_id
            || event['Club.id']
            || event.Club?.id
            || null,
    };
};

/**
 * Event Service handles fetching and managing dynamic club events from the backend.
 * Official academic events are now handled via the separate AcademicCalendarService.
 */

const eventService = {
    // Get paginated vibrant dynamic events from the DB
    getAllEventsPage: async (page = 1, limit = 10, from = undefined) => {
        try {
            // `from` narrows the window server-side. Without it the endpoint returns every event ever,
            // oldest first, so the feed's first pages would be nothing but past events it then discards.
            const response = await api.get('/events/all', {
                params: from ? { page, limit, from } : { page, limit }
            });

            const normalizedEvents = Array.isArray(response.data?.events)
                ? response.data.events.map(normalizeListEvent).filter(Boolean)
                : [];

            return {
                events: normalizedEvents,
                currentPage: response.data?.currentPage || page,
                pageSize: response.data?.pageSize || limit,
                totalEvents: response.data?.totalEvents ?? null,
                totalPages: response.data?.totalPages ?? null,
            };
        } catch (error) {
            console.error("Error fetching events from backend:", error);
            // Return empty if backend fails, official academic dates are served separately
            return {
                events: [],
                currentPage: page,
                pageSize: limit,
                totalEvents: 0,
                totalPages: 0,
            };
        }
    },

    // Backward-compatible helper: returns only events array for a single page.
    // NOTE the defaults — page 1, limit 10. Calling this with no arguments gives you TEN events, and
    // because /events/all is ordered oldest-first with no window, they are the ten OLDEST events in
    // the database. That is fine for a "recent few" widget and completely wrong for a calendar, which
    // is what Calendar.jsx was doing. Use getEventsInRange below for any view that must be complete.
    getAllEvents: async (page = 1, limit = 10) => {
        const result = await eventService.getAllEventsPage(page, limit);
        return result.events;
    },

    /**
     * Every event overlapping [from, to] (YYYY-MM-DD), pulled page by page.
     *
     * The server caps `limit` at 50 (MAX_LIMIT in routes/event.js), so one request cannot be trusted
     * to return a whole month once the calendar is busy — hence the loop. `maxPages` is a runaway
     * guard, not an expected ceiling: at 50 per page it allows 500 events in one window, and if a
     * month ever exceeds that the calendar has bigger problems than pagination.
     */
    getEventsInRange: async (from, to, { maxPages = 10 } = {}) => {
        const out = [];
        for (let page = 1; page <= maxPages; page++) {
            let res;
            try {
                const response = await api.get('/events/all', { params: { page, limit: 50, from, to } });
                res = Array.isArray(response.data?.events)
                    ? response.data.events.map(normalizeListEvent).filter(Boolean)
                    : [];
            } catch (error) {
                console.error('Error fetching events range:', error);
                break;                       // keep whatever we already have rather than blanking the calendar
            }
            out.push(...res);
            if (res.length < 50) break;      // short page = last page
        }
        return out;
    },

    // Get total count of events
    getCount: async () => {
        try {
            const response = await api.get('/events/count');
            return response.data?.count ?? 0;
        } catch (error) {
            console.error('Error fetching event count:', error);
            return null;
        }
    },

    // Get single event by ID
    getEventById: async (id) => {
        try {
            const response = await api.get(`/events/${id}`);
            const ev = response.data?.event
                || (response.data?.events && response.data.events.length > 0 ? response.data.events[0] : null);
            return normalizeSingleEvent(ev);
        } catch (error) {
            console.error(`Error fetching event ${id}:`, error);
            return null;
        }
    },

    // Create new event
    createEvent: async (eventData) => {
        const response = await api.post('/events/add', eventData);
        return response.data.event;
    },

    // Update event
    updateEvent: async (id, eventData) => {
        const response = await api.patch(`/events/${id}`, eventData);
        return response.data.event;
    },

    // Delete event
    deleteEvent: async (id) => {
        const response = await api.delete(`/events/${id}`);
        return response.data;
    },

    // Get events for the admin panel (club-scoped: only shows events for the admin's clubs)
    getAdminEvents: async (page = 1, limit = 100) => {
        try {
            const response = await api.get('/events/admin/all', { params: { page, limit } });
            const normalizedEvents = Array.isArray(response.data?.events)
                ? response.data.events.map(normalizeListEvent).filter(Boolean)
                : [];
            return normalizedEvents;
        } catch (error) {
            console.error('Error fetching admin events:', error);
            return [];
        }
    },

    // Get preferred club events
    getPreferredClubEvents: async () => {
        const response = await api.get('/events/clubs/preferred');
        return response.data.events;
    },

    // Get preferred category events
    getPreferredCategoryEvents: async () => {
        const response = await api.get('/events/categories/preferred');
        return response.data.events;
    }
};

export default eventService;
