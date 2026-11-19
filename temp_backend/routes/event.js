const express = require('express');
const router = express.Router();
const { Event, Club, Location, EventCategory, EventCategoryAlloted, UserPreferredCategory, UserNotPreferredCategory, UserPreferredClub, UserNotPreferredClub, AdminPermissionAlloted, ClubAdmin, sequelize } = require('../database/schemas/index');
const { userLoggedIn, userData } = require('../middlewares/userAuth');
const { checkEventPermission } = require('../middlewares/permissions/event');
const cache = require('../utils/cache');
const { Op } = require('sequelize');
const { Joi, validateBody, validateParams, id, idList, isoDate } = require('../middlewares/validate');
const { PERM, permissionId } = require('../utils/permissions');

// Mirrors exactly what the handlers destructure. Required-ness matches the manual checks already in
// /add so behaviour is unchanged — the win is type safety, consistent 400s, and stripUnknown keeping
// undeclared fields out of the model write.
const eventFields = {
    name: Joi.string().trim().max(300),
    club_id: id,
    location_id: id.allow(null, ''),
    tentative_start_time: Joi.string().trim().max(40),
    duration_minutes: Joi.number().integer().min(1).max(60 * 24 * 30),
    actual_start_time: Joi.string().trim().max(40).allow(null, ''),
    description: Joi.string().trim().max(8000).allow(null, ''),
    category_ids: Joi.alternatives().try(idList, Joi.string().allow('')),
    image_url: Joi.string().trim().max(1000).allow(null, ''),
    is_all_day: Joi.boolean(),
    // An INGESTED event's venue is free text off the email ("APJ-205", "LBS Ground") — it has no
    // Location row, and the Locations table is empty in production. Without venue_text here the edit
    // form showed a blank venue dropdown for an event that HAS a venue, inviting an admin to "fix" it
    // by picking an unrelated Location, which then wins over the real one on the card.
    venue_text: Joi.string().trim().max(300).allow(null, ''),
    venue_mode: Joi.string().valid('online', 'physical', 'tba').allow(null, ''),
    // A reply email often carries the registration link the first mail lacked; it must be editable.
    registration_link: Joi.string().trim().max(1000).allow(null, ''),
    registration_deadline: isoDate,
    // Lifecycle badge shown on the student card. An event whose time moved must be able to SAY so —
    // a silent time change strands anyone who already noted the old one.
    status: Joi.string().valid('scheduled', 'updated', 'cancelled', 'rescheduled', 'completed'),
};
const addEventBody = Joi.object({
    ...eventFields,
    name: eventFields.name.required(),
    club_id: eventFields.club_id.required(),
    tentative_start_time: eventFields.tentative_start_time.required(),
    duration_minutes: eventFields.duration_minutes.required(),
});
const patchEventBody = Joi.object(eventFields);
const eventIdParam = Joi.object({ eventId: id.required() });


class NotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NotFoundError';
    }
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const getPaginationParams = (req) => {
    const parsedPage = Number.parseInt(req.query?.page, 10);
    const parsedLimit = Number.parseInt(req.query?.limit, 10);

    const page = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : DEFAULT_PAGE;
    const limit = Number.isInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;
    const offset = (page - 1) * limit;

    return { page, limit, offset };
};

const buildPaginationMeta = (count, page, limit) => ({
    currentPage: page,
    pageSize: limit,
    totalEvents: count,
    totalPages: Math.max(1, Math.ceil(count / limit))
});

const startOfToday = () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now;
};

const normalizeCategoryIds = (categoryIds) => {
    if (!Array.isArray(categoryIds)) return [];

    return categoryIds
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0);
};

const normalizeEventTimestamp = (value) => {
    if (value === undefined || value === null || value === '') return null;

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString();
    }

    const raw = String(value).trim();
    if (!raw) return null;

    const naiveMatch = String(raw).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
    if (naiveMatch) {
        const [, datePart, timePart, secondPart] = naiveMatch;
        // Interpret naive values as IST wall-clock for backward compatibility.
        const withOffset = `${datePart}T${timePart}:${secondPart || '00'}+05:30`;
        const parsedNaive = new Date(withOffset);
        if (Number.isNaN(parsedNaive.getTime())) return null;
        return parsedNaive.toISOString();
    }

    const zonedMatch = String(raw).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i);
    if (zonedMatch) {
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return null;
        return parsed.toISOString();
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
};

const standardFlatAttributes = [
    'id',
    'name',
    'club_id',
    'tentative_start_time',
    'duration_minutes',
    'actual_start_time',
    'description',
    'image_url',
    [sequelize.col('Club.name'), 'club_name'],
    [sequelize.col('Club.logo_url'), 'club_logo_url'],
    [sequelize.col('Location.id'), 'location_id'],
    [sequelize.col('Location.name'), 'location_name'],
    [sequelize.col('Location.description'), 'location_description'],
    [sequelize.col('Location.images'), 'location_images'],
    'is_all_day',
    'status',   // scheduled|updated|cancelled|rescheduled|completed — lets the feed badge lifecycle changes
    'venue_text',  // freeform venue for ingested events (student card falls back to this when no Location)
    // 'Online' and 'room not decided yet' are DIFFERENT states and must not collapse into each other.
    // locationLabel() in EventCard keys off this; without it in the SELECT the column exists, the
    // publisher writes it, and the UI silently never sees it — an online event then renders whatever
    // freeform venue_text happens to hold, and a deferred venue reads 'Location TBA'.
    'venue_mode',
    // The registration link + apply-by have existed on the model since ingestion began and are written
    // by publishEvent — but they were in NEITHER allowlist, so no event has ever shown a student a
    // registration link. Ingested events routinely carry one (a Google Form, a Channel-i form), and it
    // was silently dropped at the API boundary; the workaround was pasting the URL into description text.
    'registration_link',
    'registration_deadline'
];

// Event CRUD permission ID — must match value in admin_permission table

// Public feed route — returns ALL events for the home feed (unfiltered by club admin scope)
router.get('/all', userLoggedIn, async (req, res) => {
    try {
        const { page, limit, offset } = getPaginationParams(req);
        
        // Cache Key based on pagination
        // Optional window. The route used to have an empty where clause and hand back EVERY event ever
        // created, ordered oldest-first. The calendar wants that (it renders past months), but the feed
        // does not: it pages from page 1 and drops past events in the browser, so once the table holds a
        // few hundred rows the first pages would be entirely history and the feed would look EMPTY until
        // the reader paged through all of it. `from` lets the feed ask only for what it will show.
        const { from, to } = req.query;
        // OVERLAP, not start-time. The window used to be `tentative_start_time >= from`, which drops an
        // event the morning after it BEGINS — so a four-day fest was visible on day one and gone for the
        // remaining three while it was still running. Thomso, Cognizance and every multi-day fest are
        // exactly the events this hurt most.
        //
        // An event belongs in [from, to] if it is still running during it: it starts before the window
        // ends AND ends after the window starts. The end is start + duration_minutes, which is the
        // expression the schema comment already documented and no query ever used.
        // Both dates are regex-validated to YYYY-MM-DD above, so they are safe to interpolate.
        const clauses = [];
        const END_EXPR = '"Event"."tentative_start_time" + make_interval(mins => COALESCE("Event"."duration_minutes", 0))';
        if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
            clauses.push(sequelize.literal(`${END_EXPR} >= '${from}T00:00:00+05:30'`));
        }
        if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
            const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 864e5).toISOString();
            clauses.push(sequelize.literal(`"Event"."tentative_start_time" < '${end}'`));
        }
        const whereClause = clauses.length ? { [Op.and]: clauses } : {};

        const cacheKey = `events_all_page_${page}_limit_${limit}_from_${from || ''}_to_${to || ''}`;
        const cachedData = cache.get(cacheKey);
        if (cachedData) {
            return res.json(cachedData);
        }

        const [count, events] = await Promise.all([
            Event.count({ where: whereClause }),
            Event.findAll({
                attributes: standardFlatAttributes,
                include: [
                    {
                        model: Club,
                        attributes: [], // Empty attributes required when using sequelize.col() above
                        required: false
                    },
                    {
                        model: Location,
                        attributes: [], // Empty attributes required when using sequelize.col() above
                        required: false
                    }
                ],
                where: whereClause,
                order: [['tentative_start_time', 'ASC']],
                limit: limit,
                offset: offset,
                raw: true,
                subQuery: false
            })
        ]);

        const eventIds = events.map((ev) => ev.id);

        let categoryRows = [];
        if (eventIds.length > 0) {
            categoryRows = await EventCategoryAlloted.findAll({
                where: {
                    event_id: {
                        [Op.in]: eventIds,
                    },
                },
                attributes: ['event_id', 'event_category_id'],
                raw: true,
            });
        }

        const categoryIds = Array.from(new Set(categoryRows.map((row) => row.event_category_id)));
        const categories = categoryIds.length > 0
            ? await EventCategory.findAll({
                where: {
                    id: {
                        [Op.in]: categoryIds,
                    },
                },
                attributes: ['id', 'name'],
                raw: true,
            })
            : [];

        const categoryNameById = new Map(categories.map((cat) => [Number(cat.id), cat.name]));
        const categoryIdsByEventId = new Map();

        for (const row of categoryRows) {
            const eventId = Number(row.event_id);
            const catId = Number(row.event_category_id);
            const existing = categoryIdsByEventId.get(eventId) || [];
            existing.push(catId);
            categoryIdsByEventId.set(eventId, existing);
        }

        const enrichedEvents = events.map((ev) => {
            const ids = categoryIdsByEventId.get(Number(ev.id)) || [];
            const names = ids
                .map((id) => categoryNameById.get(id))
                .filter(Boolean);

            return {
                ...ev,
                category_ids: ids,
                categories: names.join(', '),
            };
        });

        const responseData = {
            events: enrichedEvents,
            ...buildPaginationMeta(count, page, limit)
        };

        // Cache the response for 30 seconds to handle peak traffic load
        cache.set(cacheKey, responseData, 30);

        res.json(responseData);
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch events'
        });
    }
});

// Admin-only route — club-scoped event listing for the Admin Panel
// - Global event admins (permissionId(PERM.EVENT_CRUD)) see ALL events
// - Club-scoped admins only see events belonging to their managed clubs
router.get('/admin/all', userData, async (req, res) => {
    try {
        const userId = req.user.user_id;
        const { page, limit, offset } = getPaginationParams(req);
        const whereClause = {};

        const [globalPermission, clubAdminRows] = await Promise.all([
            AdminPermissionAlloted.findOne({
                where: { user_id: userId, admin_permission_id: permissionId(PERM.EVENT_CRUD) },
                attributes: ['user_id']
            }),
            ClubAdmin.findAll({
                where: { user_id: userId },
                attributes: ['club_id'],
                raw: true
            })
        ]);

        if (!globalPermission) {
            const managedClubIds = clubAdminRows.map(row => Number(row.club_id));
            if (managedClubIds.length === 0) {
                return res.json({
                    events: [],
                    ...buildPaginationMeta(0, page, limit)
                });
            }
            whereClause.club_id = { [Op.in]: managedClubIds };
        }

        const [count, events] = await Promise.all([
            Event.count({ where: whereClause }),
            Event.findAll({
                attributes: standardFlatAttributes,
                include: [
                    { model: Club, attributes: [], required: false },
                    { model: Location, attributes: [], required: false }
                ],
                where: whereClause,
                order: [['tentative_start_time', 'ASC']],
                limit,
                offset,
                raw: true,
                subQuery: false
            })
        ]);

        const eventIds = events.map((ev) => ev.id);
        let categoryRows = [];
        if (eventIds.length > 0) {
            categoryRows = await EventCategoryAlloted.findAll({
                where: { event_id: { [Op.in]: eventIds } },
                attributes: ['event_id', 'event_category_id'],
                raw: true,
            });
        }

        const categoryIds = Array.from(new Set(categoryRows.map((row) => row.event_category_id)));
        const allCategories = categoryIds.length > 0
            ? await EventCategory.findAll({
                where: { id: { [Op.in]: categoryIds } },
                attributes: ['id', 'name'],
                raw: true,
            })
            : [];

        const categoryNameById = new Map(allCategories.map((cat) => [Number(cat.id), cat.name]));
        const categoryIdsByEventId = new Map();
        for (const row of categoryRows) {
            const eventId = Number(row.event_id);
            const catId = Number(row.event_category_id);
            const existing = categoryIdsByEventId.get(eventId) || [];
            existing.push(catId);
            categoryIdsByEventId.set(eventId, existing);
        }

        const enrichedEvents = events.map((ev) => {
            const ids = categoryIdsByEventId.get(Number(ev.id)) || [];
            const names = ids.map((id) => categoryNameById.get(id)).filter(Boolean);
            return { ...ev, category_ids: ids, categories: names.join(', ') };
        });

        res.json({
            events: enrichedEvents,
            ...buildPaginationMeta(count, page, limit)
        });
    } catch (error) {
        console.error('Error fetching admin events:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch events'
        });
    }
});



// Protected route to fetch total number of events
router.get('/count', userLoggedIn, async (req, res) => {
    try {
        const count = await Event.count()

        res.status(200).json({
            count,
            success: "true"
        })

    } catch (error) {
        console.error('Error fetching total number of events:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch total number of events'
        });
    }
})

// Protected route to get events by venue/location ID
router.get('/venue/:venue_id', userLoggedIn, async (req, res) => {
    const { venue_id } = req.params;

    try {
        const { page, limit, offset } = getPaginationParams(req);

        const { rows: events, count } = await Event.findAndCountAll({
            attributes: standardFlatAttributes,
            include: [
                {
                    model: Club,
                    attributes: [],
                    required: false
                },
                {
                    model: Location,
                    attributes: [],
                    required: false
                }
            ],
            where: {
                location_id: venue_id,
                tentative_start_time: {
                    [Op.gte]: startOfToday()
                }
            },
            order: [['tentative_start_time', 'DESC']],
            limit,
            offset,
            raw: true,
            subQuery: false,
            distinct: true,
            col: 'id'
        });

        res.json({
            events,
            ...buildPaginationMeta(count, page, limit)
        });
    } catch (error) {
        console.error('Error fetching venue events:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch venue events'
        });
    }
});

// Protected route to get events by date (YYYY-MM-DD)
router.get('/date/:date', userLoggedIn, async (req, res) => {
    const { date } = req.params;

    // Reject a malformed date up front. It used to fall through to the query and come back as a 500,
    // which is indistinguishable from the server being broken.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
        return res.status(400).json({ error: 'Bad request', message: 'Date must be YYYY-MM-DD' });
    }
    const dayStart = new Date(`${date}T00:00:00+05:30`);
    if (Number.isNaN(dayStart.getTime())) {
        return res.status(400).json({ error: 'Bad request', message: 'Not a real date' });
    }
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    try {
        const { page, limit, offset } = getPaginationParams(req);

        const { rows: events, count } = await Event.findAndCountAll({
            attributes: standardFlatAttributes,
            include: [
                {
                    model: Club,
                    attributes: [],
                    required: false
                },
                {
                    model: Location,
                    attributes: [],
                    required: false
                }
            ],
            // A day is an IST day. Two bugs lived in the previous version:
            //   sequelize.cast(date, 'DATE') emitted CAST(2026-08-25 AS DATE) UNQUOTED, so Postgres
            //   read it as arithmetic (2026-8-25 = 1993) and failed casting an integer to date —
            //   every request to this route 500'd, valid or not.
            //   Casting the column to DATE also compares the UTC day, so an 8 PM IST event (14:30 UTC
            //   the same day, but 00:30 UTC the next for anything after 18:30) lands on the wrong date.
            // A half-open range on the raw timestamp fixes both, and can use the index.
            where: { tentative_start_time: { [Op.gte]: dayStart, [Op.lt]: dayEnd } },
            order: [['tentative_start_time', 'DESC']],
            limit,
            offset,
            raw: true,
            subQuery: false,
            distinct: true,
            col: 'id'
        });

        res.json({
            events,
            ...buildPaginationMeta(count, page, limit)
        });
    } catch (error) {
        console.error('Error fetching date-wise events:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch events for the selected date'
        });
    }
});

// Protected route to get particular event details by event ID
router.get('/:eventId', userLoggedIn, async (req, res) => {
    const { eventId } = req.params;
    // Reject non-numeric ids up front: a bad path segment would otherwise hit Postgres as an invalid
    // integer and surface as a 500. Clean 400 instead.
    if (!/^\d+$/.test(String(eventId))) return res.status(400).json({ error: 'Invalid event id' });
    try {
        const event = await Event.findByPk(eventId, {
            attributes: [
                'id',
                'name',
                'tentative_start_time',
                'duration_minutes',
                'actual_start_time',
                'description',
                'image_url',
                // These four were missing, so the detail view contradicted the feed card it was opened
                // from: 9 of 10 live events showed a venue on the card and NO location section here.
                // An ingested event has no Location row — venue_text IS its venue — and without
                // is_all_day an all-day item renders a spurious 12:00 AM, while a cancelled or
                // rescheduled one loses its lifecycle badge.
                'venue_text',
                'venue_mode',
                'is_all_day',
                'status',
                // same omission as the feed list — a detail page that cannot show the link a student
                // needs in order to actually register for the thing they are reading about.
                'registration_link',
                'registration_deadline'
            ],
            include: [
                {
                    model: Club,
                    attributes: ['name', 'logo_url'], // Standard include because raw: true is false
                    required: false
                },
                {
                    model: Location,
                    attributes: ['id', 'name', 'description', 'images'], // Standard include
                    required: false
                },
                {
                    model: EventCategory,
                    attributes: ['id', 'name'],
                    through: { attributes: [] },
                    required: false
                }
            ],
            subQuery: false
        });

        if (!event) {
            return res.status(404).json({
                error: 'Not found',
                message: 'Event not found'
            });
        }

        const plainEvent = event.toJSON();
        const categories = Array.isArray(plainEvent.EventCategories) ? plainEvent.EventCategories : [];
        
        // Flatten payload to match raw payload fields (club_name, club_logo_url) 
        const flatEvent = {
            ...plainEvent,
            club_name: plainEvent.Club?.name,
            club_logo_url: plainEvent.Club?.logo_url,
            location_id: plainEvent.Location?.id,
            location_name: plainEvent.Location?.name,
            location_description: plainEvent.Location?.description,
            location_images: plainEvent.Location?.images,
            category_ids: categories.map((cat) => cat.id),
            categories,
        };
        
        delete flatEvent.Club;
        delete flatEvent.Location;
        delete flatEvent.EventCategories;

        res.json({
            event: flatEvent
        });
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch events'
        });
    }
});

// Protected route to get events from user's preferred clubs
router.get('/clubs/preferred', userData, async (req, res) => {
    try {
        const { page, limit, offset } = getPaginationParams(req);

        const { rows: events, count } = await Event.findAndCountAll({
            attributes: standardFlatAttributes,
            include: [
                {
                    model: Club,
                    attributes: [],
                    required: true,
                    include: [{
                        model: UserPreferredClub,
                        where: { user_id: req.user.user_id },
                        attributes: [],
                        required: true
                    }]
                },
                {
                    model: Location,
                    attributes: [],
                    required: false
                }
            ],
            where: {
                tentative_start_time: {
                    [Op.gte]: new Date()
                }
            },
            order: [['tentative_start_time', 'DESC']],
            limit,
            offset,
            raw: true,
            subQuery: false,
            distinct: true,
            col: 'id'
        });

        res.json({
            events,
            ...buildPaginationMeta(count, page, limit)
        });
    } catch (error) {
        console.error('Error fetching preferred club events:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch preferred club events'
        });
    }
});

// Protected route to get events from user's NOT preferred clubs
router.get('/clubs/not-preferred', userData, async (req, res) => {
    try {
        const { page, limit, offset } = getPaginationParams(req);

        // SECURITY FIX: Fetch user's not preferred clubs as data, not SQL injection
        const notPreferredClubs = await UserNotPreferredClub.findAll({
            where: { user_id: req.user.user_id },
            attributes: ['club_id'],
            raw: true
        });
        const notPreferredClubIds = notPreferredClubs.map(row => row.club_id);

        const { rows: events, count } = await Event.findAndCountAll({
            attributes: standardFlatAttributes,
            include: [
                {
                    model: Club,
                    attributes: [],
                    required: true
                },
                {
                    model: Location,
                    attributes: [],
                    required: false
                }
            ],
            where: {
                club_id: notPreferredClubIds.length > 0 ? { [Op.in]: notPreferredClubIds } : { [Op.eq]: null },
                tentative_start_time: {
                    [Op.gte]: startOfToday()
                }
            },
            order: [['tentative_start_time', 'DESC']],
            limit,
            offset,
            raw: true,
            subQuery: false,
            distinct: true,
            col: 'id'
        });

        res.json({
            events,
            ...buildPaginationMeta(count, page, limit)
        });
    } catch (error) {
        console.error('Error fetching not preferred club events:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch not preferred club events'
        });
    }
});

// Protected route to get events from user's preferred categories
router.get('/categories/preferred', userData, async (req, res) => {
    try {
        const { page, limit, offset } = getPaginationParams(req);

        // SECURITY FIX: Fetch user's preferred categories as data, not SQL injection
        const preferredCategories = await UserPreferredCategory.findAll({
            where: { user_id: req.user.user_id },
            attributes: ['event_category_id'],
            raw: true
        });
        
        const categoryIds = preferredCategories.map(row => row.event_category_id);
        
        // With no categories chosen there is nothing to look up. The previous code still ran the query
        // with `where: { [Op.eq]: null }` — a bare operator at the TOP level of a where clause, not
        // scoped to any column — which is not valid and made both of these routes 500 for any user who
        // had not set a category preference. Which is everyone, since there is no UI for it yet.
        const eventIdList = categoryIds.length === 0 ? [] : (await EventCategoryAlloted.findAll({
            where: { event_category_id: { [Op.in]: categoryIds } },
            attributes: ['event_id'],
            raw: true,
            group: ['event_id'],
            subQuery: false
        })).map((row) => row.event_id);

        const { rows: events, count } = await Event.findAndCountAll({
            attributes: standardFlatAttributes,
            include: [
                {
                    model: Club,
                    attributes: [],
                    required: false
                },
                {
                    model: Location,
                    attributes: [],
                    required: false
                }
            ],
            where: {
                id: eventIdList.length > 0 ? { [Op.in]: eventIdList } : { [Op.eq]: null },
                tentative_start_time: {
                    [Op.gte]: startOfToday()
                }
            },
            order: [['tentative_start_time', 'DESC']],
            limit,
            offset,
            raw: true,
            subQuery: false,
            distinct: true,
            col: 'id'
        });

        res.json({
            events,
            ...buildPaginationMeta(count, page, limit)
        });
    } catch (error) {
        console.error('Error fetching preferred category events:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch preferred category events'
        });
    }
});

// Protected route to get events from user's NOT preferred categories
router.get('/categories/not-preferred', userData, async (req, res) => {
    try {
        const { page, limit, offset } = getPaginationParams(req);

        // SECURITY FIX: Fetch user's not preferred categories as data, not SQL injection
        const notPreferredCategories = await UserNotPreferredCategory.findAll({
            where: { user_id: req.user.user_id },
            attributes: ['event_category_id'],
            raw: true
        });
        
        const categoryIds = notPreferredCategories.map(row => row.event_category_id);
        
        // With no categories chosen there is nothing to look up. The previous code still ran the query
        // with `where: { [Op.eq]: null }` — a bare operator at the TOP level of a where clause, not
        // scoped to any column — which is not valid and made both of these routes 500 for any user who
        // had not set a category preference. Which is everyone, since there is no UI for it yet.
        const eventIdList = categoryIds.length === 0 ? [] : (await EventCategoryAlloted.findAll({
            where: { event_category_id: { [Op.in]: categoryIds } },
            attributes: ['event_id'],
            raw: true,
            group: ['event_id'],
            subQuery: false
        })).map((row) => row.event_id);

        const { rows: events, count } = await Event.findAndCountAll({
            attributes: standardFlatAttributes,
            include: [
                {
                    model: Club,
                    attributes: [],
                    required: false
                },
                {
                    model: Location,
                    attributes: [],
                    required: false
                }
            ],
            where: {
                id: eventIdList.length > 0 ? { [Op.in]: eventIdList } : { [Op.eq]: null },
                tentative_start_time: {
                    [Op.gte]: startOfToday()
                }
            },
            order: [['tentative_start_time', 'DESC']],
            limit,
            offset,
            raw: true,
            subQuery: false,
            distinct: true,
            col: 'id'
        });

        res.json({
            events,
            ...buildPaginationMeta(count, page, limit)
        });
    } catch (error) {
        console.error('Error fetching not preferred category events:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not fetch not preferred category events'
        });
    }
});

// Protected route to update an event
router.patch('/:eventId', checkEventPermission, validateParams(eventIdParam), validateBody(patchEventBody), async (req, res) => {
    const { eventId } = req.params;
    const {
        name,
        club_id,
        location_id,
        tentative_start_time,
        duration_minutes,
        actual_start_time,
        description,
        category_ids,
        image_url,
        is_all_day,
        venue_text,
        venue_mode,
        registration_link,
        registration_deadline,
        status
    } = req.body;

    try {
        // Build update object with only provided fields
        const updateData = {};
        // `!== undefined` so an explicit empty string CLEARS a value, while an untouched field is left
        // alone — the edit form only sends what it shows.
        if (venue_text !== undefined) updateData.venue_text = venue_text || null;
        if (venue_mode !== undefined) updateData.venue_mode = venue_mode || null;
        if (registration_link !== undefined) updateData.registration_link = registration_link || null;
        if (registration_deadline !== undefined) updateData.registration_deadline = registration_deadline || null;
        if (status !== undefined) updateData.status = status;
        if (name !== undefined) updateData.name = name;
        if (club_id !== undefined && !isNaN(parseInt(club_id))) updateData.club_id = parseInt(club_id);
        if (location_id !== undefined) updateData.location_id = location_id ? parseInt(location_id) : null;
        if (tentative_start_time !== undefined) {
            const normalizedStart = normalizeEventTimestamp(tentative_start_time);
            if (!normalizedStart) {
                return res.status(400).json({
                    error: 'Bad request',
                    message: 'Invalid tentative_start_time format'
                });
            }
            updateData.tentative_start_time = normalizedStart;
        }
        if (duration_minutes !== undefined) updateData.duration_minutes = duration_minutes;
        if (actual_start_time !== undefined) {
            if (actual_start_time === null || actual_start_time === '') {
                updateData.actual_start_time = null;
            } else {
                const normalizedActual = normalizeEventTimestamp(actual_start_time);
                if (!normalizedActual) {
                    return res.status(400).json({
                        error: 'Bad request',
                        message: 'Invalid actual_start_time format'
                    });
                }
                updateData.actual_start_time = normalizedActual;
            }
        }
        if (description !== undefined) updateData.description = description;
        if (image_url !== undefined) updateData.image_url = image_url;
        if (is_all_day !== undefined) updateData.is_all_day = is_all_day;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'No fields to update'
            });
        }

        let updatedEvent;
        await sequelize.transaction(async (t) => {
            const result = await Event.update(updateData, {
                where: { id: eventId },
                returning: true,
                transaction: t
            });

            if (result[0] === 0) {
                throw new NotFoundError('Event not found');
            }

            updatedEvent = result[1][0];

            if (category_ids !== undefined) {
                const normalizedCategoryIds = normalizeCategoryIds(category_ids);

                await EventCategoryAlloted.destroy({
                    where: { event_id: eventId },
                    transaction: t
                });

                if (normalizedCategoryIds.length > 0) {
                    const rows = normalizedCategoryIds.map((categoryId) => ({
                        event_id: eventId,
                        event_category_id: categoryId
                    }));

                    await EventCategoryAlloted.bulkCreate(rows, { transaction: t });
                }
            }
        });

        res.json({
            message: 'Event updated successfully',
            event: updatedEvent
        });
    } catch (error) {
        console.error('Error updating event:', error);

        if (error.name === 'NotFoundError') {
            return res.status(404).json({
                error: 'Not found',
                message: error.message
            });
        }

        // Check for overlapping events constraint violation
        if (error.code === '23P01' || error.message?.includes('no_overlapping_events_at_location')) {
            return res.status(409).json({
                error: 'Conflict',
                message: 'This time slot is already occupied at the selected location. Please choose a different time or location.'
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not process event'
        });
    }
});

// Protected route to delete an event
router.delete('/:eventId', checkEventPermission, async (req, res) => {
    const { eventId } = req.params;

    try {
        const result = await Event.destroy({
            where: { id: eventId }
        });

        if (result === 0) {
            return res.status(404).json({
                error: 'Not found',
                message: 'Event not found'
            });
        }

        res.json({
            message: 'Event deleted successfully',
            eventId: eventId
        });
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not delete event'
        });
    }
});

// Protected route to add a new event
router.post('/add', checkEventPermission, validateBody(addEventBody), async (req, res) => {
    const {
        name,
        club_id,
        location_id,
        tentative_start_time,
        duration_minutes,
        actual_start_time,
        description,
        category_ids,
        image_url,
        is_all_day,
        // Declared in the Joi schema is not enough — these handlers destructure an explicit list, so a
        // field absent HERE is silently dropped even though validation accepted it.
        venue_text,
        venue_mode,
        registration_link,
        registration_deadline
    } = req.body;

    try {
        // Validate required fields
        if (!name) return res.status(400).json({ error: 'Bad request', message: 'Event name is required' });
        if (!club_id || isNaN(parseInt(club_id))) return res.status(400).json({ error: 'Bad request', message: 'A valid Club ID is required' });
        if (!tentative_start_time) return res.status(400).json({ error: 'Bad request', message: 'Tentative start time is required' });
        if (!duration_minutes || isNaN(parseInt(duration_minutes))) return res.status(400).json({ error: 'Bad request', message: 'Duration (in minutes) is required' });

        const normalizedCategoryIds = normalizeCategoryIds(category_ids);
        const normalizedTentativeStartTime = normalizeEventTimestamp(tentative_start_time);
        const normalizedActualStartTime = actual_start_time
            ? normalizeEventTimestamp(actual_start_time)
            : null;

        if (!normalizedTentativeStartTime) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'Invalid tentative_start_time format. Expected YYYY-MM-DDTHH:MM'
            });
        }

        if (actual_start_time && !normalizedActualStartTime) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'Invalid actual_start_time format'
            });
        }

        let createdEvent;
        await sequelize.transaction(async (t) => {
            createdEvent = await Event.create({
                name,
                club_id,
                location_id: location_id || null,
                tentative_start_time: normalizedTentativeStartTime,
                duration_minutes,
                actual_start_time: normalizedActualStartTime,
                description: description || null,
                image_url: image_url || '',
                is_all_day: is_all_day || false,
                // The venue of a manually-created event is the same free text an ingested one carries,
                // so both write venue_text and the card renders them identically.
                venue_text: venue_text || null,
                venue_mode: venue_mode || null,
                registration_link: registration_link || null,
                registration_deadline: registration_deadline || null
            }, { transaction: t });

            if (normalizedCategoryIds.length > 0) {
                const rows = normalizedCategoryIds.map((categoryId) => ({
                    event_id: createdEvent.id,
                    event_category_id: categoryId
                }));

                await EventCategoryAlloted.bulkCreate(rows, { transaction: t });
            }
        });

        res.status(201).json({
            message: 'Event created successfully',
            event: createdEvent
        });
    } catch (error) {
        console.error('Error creating event:', error);

        // Check for overlapping events constraint violation
        if (error.code === '23P01' || error.message?.includes('no_overlapping_events_at_location')) {
            return res.status(409).json({
                error: 'Conflict',
                message: 'This time slot is already occupied at the selected location. Please choose a different time or location.'
            });
        }

        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not process event'
        });
    }
});

module.exports = router;