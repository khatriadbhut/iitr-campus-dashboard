import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, Bell, CheckCircle, Calendar, ChevronDown } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import EventCard from '../components/Event/EventCard';
import NoticeActions from '../components/Notice/NoticeActions';
import FilterDropdown from '../components/Common/FilterDropdown';
import '../components/Common/FilterDropdown.css';
import eventService from '../services/events';
import academicCalendarService from '../services/academicCalendar';
import noticesService from '../services/notices';
import notificationsService from '../services/notifications';
import { noticeKind, noticeSnippet, deadlineChip, fmtDate, isExternalNotice, isNoticeOnFeed } from '../utils/notice';
import { isEventOnFeed, eventOverlaps } from '../utils/eventTime';

import eventReminderService from '../services/eventReminders';
import todoService from '../services/todo';

import { useAuth } from '../context/AuthContext';
import { notify } from '../services/notify';
import './Home.css';


const extractCategoryNames = (event) => {
    if (Array.isArray(event?.categories)) {
        return event.categories
            .map((cat) => (typeof cat === 'string' ? cat : cat?.name))
            .filter(Boolean);
    }

    if (typeof event?.categories === 'string') {
        return event.categories
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean);
    }

    return [];
};

// ── Search ───────────────────────────────────────────────────────────────────────────────────────
// EVERY word must appear SOMEWHERE across the item's fields, in any order. The old test was a single
// substring `includes()` over three fields, so "cinema screening" found nothing unless those two words
// happened to sit adjacent in that order — "Screening by Cinema Club" did not match.
const searchTokens = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);

const matchesTokens = (tokens, fields) => {
    if (!tokens.length) return true;
    const hay = fields.filter(Boolean).join('\n').toLowerCase();
    return tokens.every((t) => hay.includes(t));
};

// The event fields worth searching. `venue_text` matters as much as `location_name`: the card renders
// `location_name || venue_text || venue` (locationLabel in EventCard), and for ingested events the
// Locations table is empty, so the venue a student can SEE on the card lives in venue_text. Searching
// only location_name meant a card reading "MAC Auditorium" could not be found by typing "MAC".
// There is no `speaker` column on the event model — the pipeline writes the speaker into the
// description, so including description is what makes a speaker's name findable.
const eventHaystack = (ev) => [
    ev.name,
    ev.description,
    ev.club_name,
    ev.location_name,
    ev.location_description,
    ev.venue_text,
    ev.venue,
    ...extractCategoryNames(ev),
];

// Today in IST as YYYY-MM-DD. toISOString() is UTC and would hand back yesterday's date all
// morning until 05:30 IST, quietly hiding the day's own events.
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const Home = () => {
    const navigate = useNavigate();

    // The header bell already existed and already linked here; its dot just meant "you have reminders
    // set". It now means "you have unread alerts", which is what a bell is understood to say.
    // Polled at the generator's own 60s cadence — Phase 1 has no service worker to push it.
    const [unreadAlerts, setUnreadAlerts] = useState(0);
    useEffect(() => {
        let cancelled = false;
        const refresh = () => notificationsService.list()
            .then(({ unread }) => { if (!cancelled) setUnreadAlerts(unread); })
            .catch(() => { /* a badge is not worth surfacing an error for */ });
        refresh();
        const timer = setInterval(refresh, 60000);
        return () => { cancelled = true; clearInterval(timer); };
    }, []);
    const { user, loading: authLoading, backendSlow } = useAuth();
    
    const [selectedCategories, setSelectedCategories] = useState([]);
    // The tab lives in the URL so that leaving and coming back keeps your place. It used to be
    // plain state: open a notice, press back, and you landed on Events with your list gone, having
    // to re-select Notices every time. `replace` keeps tab switches OUT of history, so back still
    // means "leave Home" rather than stepping through tabs you already looked at.
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = searchParams.get('tab') === 'notices' ? 'notices' : 'events';
    const setTab = (v) => setSearchParams(v === 'notices' ? { tab: 'notices' } : {}, { replace: true });
    const [dateFilter, setDateFilter] = useState('all'); // all | today | week | month
    // Multi-select, like the Events category chips. Empty means no filter — every notice shows.
    const [selectedNoticeKinds, setSelectedNoticeKinds] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [showTodosInFeed, setShowTodosInFeed] = useState(() => localStorage.getItem('iitr_show_feed_todos') === 'true');
    const [reminderEventIds, setReminderEventIds] = useState(() => new Set(eventReminderService.getReminderIds()));
    const sentinelRef = useRef(null);
    const PAGE_SIZE = 10;

    useEffect(() => {
        const syncTodoFeedPref = () => {
            setShowTodosInFeed(localStorage.getItem('iitr_show_feed_todos') === 'true');
        };

        window.addEventListener('focus', syncTodoFeedPref);
        window.addEventListener('storage', syncTodoFeedPref);
        window.addEventListener('iitr:todo-feed-toggle-changed', syncTodoFeedPref);

        return () => {
            window.removeEventListener('focus', syncTodoFeedPref);
            window.removeEventListener('storage', syncTodoFeedPref);
            window.removeEventListener('iitr:todo-feed-toggle-changed', syncTodoFeedPref);
        };
    }, []);

    const { data: pageData, size, setSize, isLoading: dynLoading, isValidating: dynValidating } = useSWRInfinite(
        (pageIndex, previousPageData) => {
            if (!user || authLoading) return null;
            if (previousPageData && previousPageData.events && previousPageData.events.length < PAGE_SIZE) return null;
            return `dynamic_events_page_${pageIndex + 1}`;
        },
        async (key) => {
            const split = key.split('_');
            const targetPage = parseInt(split[split.length - 1]);
            // Only ask for events from today onward. The endpoint returns oldest-first, so without this
            // the first pages fill with past events that the feed then filters out — invisible at 7
            // events, an empty-looking feed once the table has a few hundred.
            return await eventService.getAllEventsPage(targetPage, PAGE_SIZE, istToday());
        }
    );

    const dynamicEvents = useMemo(() => {
        if (!pageData) return [];
        const combined = [];
        const seen = new Set();
        pageData.forEach((pageObj) => {
            if (pageObj && pageObj.events) {
                pageObj.events.forEach((ev) => {
                    const key = String(ev.id);
                    if (!seen.has(key)) {
                        seen.add(key);
                        combined.push(ev);
                    }
                });
            }
        });
        return combined;
    }, [pageData]);

    const loading = dynLoading;
    const loadingMore = dynLoading || (size > 0 && pageData && typeof pageData[size - 1] === "undefined");
    const hasMore = pageData ? (pageData[pageData.length - 1]?.events?.length >= PAGE_SIZE) : true;
    const initialLoaded = !!pageData;

    const { data: rawAcademicEvents = [] } = useSWR(
        (user && !authLoading) ? 'cal_academic' : null,
        () => academicCalendarService.getAllEvents()
    );

    const { data: rawTodos = [] } = useSWR(
        (user && !authLoading && showTodosInFeed) ? 'cal_todos' : null,
        () => todoService.getAll()
    );

    // Notices tab (email-ingested): important first, then nearest deadline.
    const { data: noticesData } = useSWR(
        (user && !authLoading) ? 'ingestion_notices' : null,
        () => noticesService.getNotices()
    );
    const notices = noticesData?.notices || [];

    // Which notices are already on the todo list. Matched by NAME because a notice todo carries no
    // linked_event_id — that column points at the events table, and a notice id there would attach the
    // task to an unrelated event. Reads the same `cal_todos` key the event feed uses, so adding from
    // either surface lights up both without a reload.
    // The kinds actually present in the feed, so a chip can never lead to an empty list. Ordered by
    // how many carry it — the kind a student is most likely to want sits first.
    const noticeKinds = useMemo(() => {
        const counts = new Map();
        notices.forEach((n) => { const l = noticeKind(n).label; counts.set(l, (counts.get(l) || 0) + 1); });
        return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l);
    }, [notices]);

    const toggleNoticeKind = (k) => setSelectedNoticeKinds((prev) => (
        prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]
    ));

    const noticeTodoNames = useMemo(() => {
        const norm = (x) => String(x || '').trim().toLowerCase();
        return new Set(rawTodos.map((t) => norm(t.linked_event_name)).filter(Boolean));
    }, [rawTodos]);

    const academicEvents = useMemo(() => {
        return rawAcademicEvents.map((ae) => ({
            id: `academic-${ae.id}`,
            name: ae.title,
            tentative_start_time: `${ae.startDate}T00:00:00`,
            tentative_end_time: `${ae.endDate}T23:59:59`,
            description: ae.description,
            categories: ae.category,
            location_name: ae.isHoliday ? 'Institute Holiday' : 'Campus-wide',
            isAcademicCalendar: true,
            isAllDay: true,
            // A few calendar rows DO name the club that runs them (Thomso, Sangram, Cognizance); the
            // API attaches clubId/clubName for exactly those. Carrying club_id through is what makes
            // "hide clubs I don't follow" work on them — the test is
            // notPreferredClubIds.has(Number(ev.club_id)), and with no club_id that is has(NaN),
            // which is why un-following Thomso never removed "Thomso 2026" from the feed.
            club_id: ae.clubId ?? undefined,
            club_name: ae.clubName || 'IIT Roorkee',
        }));
    }, [rawAcademicEvents]);

    // The LOCAL calendar day. `toISOString()` is UTC, so in IST (UTC+5:30) it returns YESTERDAY
    // between 00:00 and 05:30 — a todo with no due date was filed on the wrong day for those
    // five and a half hours every night, and the same slip made deadline matching miss.
    const localDayStr = (d = new Date()) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const todoEvents = useMemo(() => {
        const activeTodos = rawTodos.filter(t => !t.completed);
        return activeTodos.map(todo => {
            const dateStr = todo.due_date || localDayStr();
            const timeStr = todo.due_time || '00:00';
            const tentative_start_time = `${dateStr}T${timeStr}:00`;
            
            return {
                id: `todo-${todo.id}`,
                name: todo.text,
                tentative_start_time,
                description: todo.notes,
                categories: 'Personal/Todo',
                location_name: todo.linked_event_name || 'Personal Task',
                isTodoEvent: true,
                // kept so the feed can tell whether this todo's source card is already on screen
                linkedEventName: todo.linked_event_name || null,
                isAllDay: !todo.due_time,
                club_name: user?.full_name || 'Personal',
                club_logo_url: user?.display_picture ? `https://channeli.in${user.display_picture}` : undefined,
            };
        });
    }, [rawTodos, user]);

    // Notices whose apply-by date is TODAY, surfaced in the events feed for that one day.
    // An opportunity (club recruitment, a PoR call, a scholarship) has a DEADLINE, not a start time —
    // publishing it as a real event would invent a date, so it stays a notice and only borrows the feed
    // on the day it actually matters. notice.deadline is DATEONLY, so there is never a time: it is an
    // ALL-DAY item running to 23:59, i.e. you have until end of day.
    // Local date, not toISOString(): before 05:30 IST the UTC date is still yesterday.
    const deadlineEvents = useMemo(() => {
        const todayStr = localDayStr();
        return notices
            .filter((n) => n.deadline === todayStr)
            .map((n) => ({
                id: `deadline-${n.id}`,
                noticeId: n.id,
                name: n.title,
                // A stated closing time ("apply by 6 PM") becomes the card's real time; with no time the
                // deadline is end of day, so it stays an all-day item running to 23:59.
                tentative_start_time: `${n.deadline}T${n.deadline_time || '00:00'}:00`,
                duration_minutes: n.deadline_time ? undefined : 1439,   // all-day → survives the "already over" filter till midnight
                description: n.body,
                categories: 'Deadline',
                location_name: n.venue || undefined,
                venue_mode: n.venue_mode || null,      // online vs room-not-decided — see EventCard
                isDeadlineItem: true,
                isAllDay: !n.deadline_time,
                sharePath: `/notices/${n.id}`,   // share the notice, not a non-existent /event/deadline-<id>
                club_name: n.club_name || 'Institute',   // real organiser; `source` is stripped by the API
            }));
    }, [notices]);

    useEffect(() => {
        eventReminderService.scheduleStoredReminders();
        setReminderEventIds(new Set(eventReminderService.getReminderIds()));
    }, []);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || !initialLoaded) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting && hasMore && !loadingMore && !loading) {
                    setSize(size + 1);
                }
            },
            { root: null, rootMargin: '300px 0px', threshold: 0 }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, loadingMore, loading]); // FIXED: Removed initialLoaded from deps to prevent observer recreation

    const events = useMemo(() => {
        const sourceCards = [...dynamicEvents, ...academicEvents, ...deadlineEvents];

        // A todo added FROM a card used to appear as a SECOND card beside the one it came from — the
        // same item twice, once as itself and once as PERSONAL/TODO. Worse, the todo copy carries no
        // clipboard or delete control, so the only way to be rid of it was to find it on the Personal
        // page; from the feed it looked stuck.
        //
        // So: a todo whose source is already on screen no longer gets its own card. It marks the
        // original instead (onTodoList), which is the thing the user actually wanted to see — that
        // this event is on their list. Todos with no source in the feed (a custom task, or one whose
        // event has scrolled out of range) still get a card of their own, since nothing else would
        // show them.
        //
        // Matched on NAME, not linked_event_id: academic-calendar rows and notice deadlines carry a
        // null id, and those are most of what the button is pressed on.
        const norm = (x) => String(x || '').trim().toLowerCase();
        const sourceNames = new Set(sourceCards.map((e) => norm(e.name)).filter(Boolean));
        const linkedNames = new Set(
            todoEvents.map((t) => norm(t.linkedEventName)).filter((n) => n && sourceNames.has(n))
        );

        const standaloneTodos = todoEvents.filter((t) => !linkedNames.has(norm(t.linkedEventName)));
        const marked = sourceCards.map((e) =>
            linkedNames.has(norm(e.name)) ? { ...e, onTodoList: true } : e
        );

        const combined = [...marked, ...standaloneTodos];

        return combined
            // Keep an event until the end of the DAY it finished on — see isEventOnFeed for why a
            // fixed grace period made the "Today" filter hide things that happened this morning.
            .filter((ev) => isEventOnFeed(ev))
            .sort((a, b) => new Date(a.tentative_start_time) - new Date(b.tentative_start_time));
            }, [dynamicEvents, academicEvents, todoEvents, deadlineEvents]);

    // Tokenised once and shared by BOTH tabs, so events and notices can never drift on what a query means.
    const queryTokens = useMemo(() => searchTokens(searchQuery), [searchQuery]);

    const availableCategories = useMemo(() => {
        const set = new Set();
        events.forEach((ev) => {
            extractCategoryNames(ev).forEach((cat) => set.add(cat));
        });
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [events]);

    const notPreferredClubIds = useMemo(
        () => new Set((user?.notPreferredClubs || []).map((id) => Number(id))),
        [user?.notPreferredClubs]
    );

    // ── NOT BUILT (deliberately): saved CATEGORY preferences ─────────────────────────────────────
    // Everything below the UI already exists and is left in place on purpose:
    //   · backend  — GET /events/categories/not-preferred, and the save path
    //   · context  — AuthContext loads user.preferredCategories / user.notPreferredCategories
    // What is missing is only the two ends:
    //   1. a picker in Profile.jsx — copy the club-visibility list already there
    //      (toggleClubVisibility / blockedClubSet, ~line 122 and ~line 266)
    //   2. one clause in the filter below, mirroring `isHiddenClub`
    // Four Sets used to be computed here and in Profile and then never read. They were not a bug,
    // just this feature stopping one step short — but they read exactly like one, and three of them
    // were lint errors drowning out real findings. Removed rather than left rotting; this comment is
    // the bookmark. The `preferred` (as opposed to `notPreferred`) half needs a product decision
    // first: pin-to-top, or a strict whitelist. Clubs only ever implemented the `notPreferred` half.

    const toggleCategory = (categoryName) => {
        setSelectedCategories((prev) => (
            prev.includes(categoryName)
                ? prev.filter((item) => item !== categoryName)
                : [...prev, categoryName]
        ));
    };

    const filteredEvents = useMemo(() => {
        return events.filter((ev) => {
            const eventCategoryNames = extractCategoryNames(ev);

            const eventClubId = Number(ev.club_id);
            const isHiddenClub = notPreferredClubIds.has(eventClubId);

            const matchesCategorySelection =
                selectedCategories.length === 0
                || selectedCategories.some((selected) => eventCategoryNames.includes(selected));

            const matchesSearch = matchesTokens(queryTokens, eventHaystack(ev));

            const matchesDate = (() => {
                if (dateFilter === 'all') return true;
                const DAY = 864e5;
                const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
                const todayStart = midnight.getTime();
                // An event belongs in a window while it is still RUNNING, not only on the day it
                // began — eventOverlaps is that test. These windows also used to carry an upper bound
                // ONLY, so "this week" read as "anything before next week", past included; it looked
                // right purely because the API had already trimmed the past out of the array.
                if (dateFilter === 'today') return eventOverlaps(ev, todayStart, todayStart + DAY);
                if (dateFilter === 'week') return eventOverlaps(ev, todayStart, todayStart + 7 * DAY);
                if (dateFilter === 'month') return eventOverlaps(ev, todayStart, todayStart + 31 * DAY);
                return true;
            })();

            // Always show todo events if their category matches, they aren't bound to club preferences
            if (ev.isTodoEvent) {
                return matchesCategorySelection && matchesSearch && matchesDate;
            }

            return matchesCategorySelection && !isHiddenClub && matchesSearch && matchesDate;
        });
    }, [events, notPreferredClubIds, selectedCategories, queryTokens, dateFilter]);

    useEffect(() => {
        filteredEvents.forEach((event) => {
            eventReminderService.updateReminderSnapshot(event);
        });
    }, [filteredEvents]);

    const handleToggleReminder = async (event) => {
        // Returned to the caller: ReminderBell needs to know when this RESOLVED with an error
        // (e.g. 'event-started') rather than throwing, or its chip stays lit over a write that
        // never happened.
        const result = await eventReminderService.toggleReminder(event);
        setReminderEventIds(new Set(eventReminderService.getReminderIds()));

        // The event is now tracked either way, so a missing OS permission is a note, not an error:
        // it is listed on the reminder hub, and only the device banner is unavailable.
        if (result.enabled && result.permission && result.permission !== 'granted') {
            notify('Tracking this event. Allow notifications to also get an alert on your device.', 'info');
        } else if (result.error === 'event-started') {
            notify('This event has already started, so reminders cannot be scheduled.', 'warning');
        } else if (result.error === 'sync-failed') {
            notify('Could not sync reminder to your account right now. Please try again.', 'error');
        }
        return result;
    };

    return (
        <div className="home-page">
            {/* Top Header Bar */}
            <div className="page-header-bar">
                <h1>Explore Events</h1>
                <div className="page-header-actions">
                    {/* Closing the box also clears the query. Otherwise dismissing it left the feed
                        silently filtered — 5 of 39 events, the search bar gone, and nothing on screen
                        saying why the rest had vanished. Reads as a broken feed, not an active search. */}
                    <button
                        className="header-icon-btn"
                        onClick={() => {
                            if (showSearch) setSearchQuery('');
                            setShowSearch((s) => !s);
                        }}
                        aria-label="Search"
                    >
                        <Search size={18} />
                    </button>
                    <button className="header-icon-btn" onClick={() => navigate('/notifications')} aria-label="Notifications & reminders" style={{ position: 'relative' }}>
                        <Bell size={18} />
                        {unreadAlerts > 0 && <span className="header-bell-dot" />}
                    </button>
                </div>
            </div>

            {/* Search Bar */}
            {showSearch && (
                <div className="home-search-bar">
                    <Search size={16} className="search-inline-icon" />
                    <input
                        autoFocus
                        type="text"
                        placeholder="Search events, clubs..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
            )}

            {/* Tab + compact date dropdown on one row */}
            <div className="home-filter-bar">
                <div className="home-tabs">
                    {[['events', 'Events'], ['notices', 'Notices']].map(([v, label]) => (
                        <button key={v} className={`home-mode-btn ${tab === v ? 'active' : ''}`} onClick={() => setTab(v)}>
                            {label}
                        </button>
                    ))}
                </div>
                <FilterDropdown
                    ariaLabel={tab === 'events' ? 'Filter events by date' : 'Filter notices by deadline'}
                    icon={<Calendar size={14} />}
                    value={dateFilter}
                    onChange={setDateFilter}
                    options={tab === 'events'
                        ? [
                            { value: 'all', label: 'All upcoming' },
                            { value: 'today', label: 'Today' },
                            { value: 'week', label: 'This week' },
                            { value: 'month', label: 'This month' },
                        ]
                        // Worded for a DEADLINE, not a start date. "Today" on a notice means it closes
                        // today, which is the opposite kind of urgency from an event happening today.
                        : [
                            { value: 'all', label: 'All notices' },
                            { value: 'today', label: 'Closing today' },
                            { value: 'week', label: 'Closing this week' },
                            { value: 'month', label: 'Closing this month' },
                        ]}
                />
            </div>

            {tab === 'notices' && (<>
                {/* Kind chips, multi-select, the same control as the Events category chips. This
                    replaces an All/Opportunities/Info tab row: those are the pipeline's own
                    sub-categorisation of a notice, not categories a student thinks in — nobody opens
                    the app looking for "an info notice". Derived from what is actually present, so a
                    chip can never lead to an empty list.

                    A SIBLING of .home-notices, not a child, which is what keeps it aligned with the
                    Events chips. .home-notices carries padding of its own, so nesting the row inside it
                    added that to .home-chips-wrap's own 16px and pushed the chips 32px in while the
                    Events row stayed at 16 — the same control, indented differently on each tab. */}
                <div className="home-chips-wrap">
                    {noticeKinds.map((k) => (
                        <button
                            key={k}
                            className={`home-chip ${selectedNoticeKinds.includes(k) ? 'active' : ''}`}
                            onClick={() => toggleNoticeKind(k)}
                        >
                            {k}
                        </button>
                    ))}
                </div>
                <div className="home-notices">
                    {(() => {
                        // Search now applies HERE too. It previously did not: the box stayed visible with
                        // your text in it while this list ignored it completely and showed everything.
                        const visible = notices.filter((n) => {
                            // Expired notices leave the feed — a stated deadline governs, and an
                            // undated one ages out. See isNoticeOnFeed for the three branches and why
                            // a date always beats the age rule (Course Drop is the case that proves it).
                            if (!isNoticeOnFeed(n)) return false;
                            // "Hide clubs I don't follow" applied to NOTICES too. It only ever ran on
                            // events, so un-following a club removed its events and left its notices —
                            // its recruitment call and its deadline stayed in the feed of someone who
                            // had explicitly said they did not want to hear from it. Same test as the
                            // events filter; a notice with no club (an office announcement) has
                            // club_id null, which no preference can match, so it is never hidden.
                            if (n.club_id != null && notPreferredClubIds.has(Number(n.club_id))) return false;
                            if (selectedNoticeKinds.length && !selectedNoticeKinds.includes(noticeKind(n).label)) return false;
                            // Deadline window. A notice with NO deadline is not "closing" in any window,
                            // so it drops out of the narrowed views rather than sitting in every one of
                            // them — an open-ended library notice is not something closing today.
                            if (dateFilter !== 'all') {
                                if (!n.deadline) return false;
                                const today = new Date(); today.setHours(0, 0, 0, 0);
                                const d = new Date(`${n.deadline}T00:00:00`);
                                const days = Math.round((d - today) / 864e5);
                                if (days < 0) return false;                       // already closed
                                if (dateFilter === 'today' && days !== 0) return false;
                                if (dateFilter === 'week' && days > 7) return false;
                                if (dateFilter === 'month' && days > 31) return false;
                            }
                            return matchesTokens(queryTokens, [n.title, n.body, noticeKind(n).label, n.audience]);
                        });
                        return visible.length === 0 ? (
                        <p className="home-notice-empty">
                            {queryTokens.length ? (
                                <>
                                    No notices match “{searchQuery}”.{' '}
                                    <button type="button" className="btn-link" onClick={() => setSearchQuery('')}>Clear search</button>
                                </>
                            ) : notices.length === 0 ? 'No notices right now.'
                                : selectedNoticeKinds.length ? `No ${selectedNoticeKinds.join(' or ')} notices right now.`
                                    : 'No notices match these filters.'}
                        </p>
                    ) : (
                        ['important', 'general'].map((section) => {
                            const rows = visible.filter((n) => n.priority === section);
                            if (!rows.length) return null;
                            return (
                                <div key={section} className="home-notice-group">
                                    <div className={`home-notice-section-title ${section === 'important' ? 'important' : ''}`}>
                                        <span>{section === 'important' ? 'Important' : 'General'}</span>
                                        <span className="home-notice-section-count">{rows.length}</span>
                                    </div>
                                    {rows.map((n) => (
                                        <div key={n.id} className="home-notice-card" role="button" tabIndex={0}
                                            onClick={() => navigate(`/notices/${n.id}`)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/notices/${n.id}`); }}>
                                            <div className="home-notice-tagrow">
                                                <div className="home-notice-tags">
                                                    {(() => { const k = noticeKind(n); return <span className={`home-notice-tag ${k.cls}`}>{k.label}</span>; })()}
                                                    {/* Run by an outside body, not the institute — the single most useful thing
                                                        to know at a glance about a competition you are deciding whether to enter. */}
                                                    {isExternalNotice(n) && <span className="home-notice-tag k-external">External</span>}
                                                    {noticeTodoNames.has(String(n.title || '').trim().toLowerCase())
                                                        && <span className="home-notice-tag k-todo">Personal/Todo</span>}
                                                    {n.audience && <span className="home-notice-badge">{n.audience}</span>}
                                                </div>
                                                <div className="home-notice-tagrow-right">
                                                    {(() => {
                                                        const dl = deadlineChip(n.deadline);
                                                        if (!dl) return null;
                                                        // A date DERIVED from the academic calendar is marked, not
                                                        // passed off as one the email stated. The email said "see the
                                                        // calendar"; this is the app having looked it up.
                                                        const derived = n.deadline_source === 'calendar';
                                                        return (
                                                            <span
                                                                className={`home-notice-dl ${dl.cls} ${derived ? 'dl-derived' : ''}`}
                                                                title={derived ? 'From the academic calendar — this notice did not state a date' : undefined}
                                                            >
                                                                {derived ? '📅' : '⏰'} {dl.label}
                                                            </span>
                                                        );
                                                    })()}
                                                    <NoticeActions
                                                        notice={n}
                                                        onTodoList={noticeTodoNames.has(String(n.title || '').trim().toLowerCase())}
                                                        isReminderEnabled={reminderEventIds.has(`notice-${n.id}`)}
                                                        onToggleReminder={handleToggleReminder}
                                                    />
                                                </div>
                                            </div>
                                            <div className="home-notice-title">{n.title}</div>
                                            {(() => {
                                                const sn = noticeSnippet(n.body);
                                                return sn.text ? (
                                                    <p className="home-notice-snippet">{sn.text}{sn.trimmed && <span className="home-notice-more"> Read more</span>}</p>
                                                ) : null;
                                            })()}
                                            <div className="home-notice-meta">
                                                {/* the organising club when there is one — an office
                                                    notice legitimately has none and shows just the date */}
                                                {n.club_name && <span className="home-notice-source">{n.club_name}</span>}
                                                {n.club_name && n.published_at && <span>·</span>}
                                                {n.published_at && <span>{fmtDate(n.published_at)}</span>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })
                    );
                    })()}
                </div>
            </>)}

            {tab === 'events' && (<>
            {/* Category Filter Chips (Multi-select) */}
            <div className="home-chips-wrap">
                {availableCategories.map((category) => (
                    <button
                        key={category}
                        className={`home-chip ${selectedCategories.includes(category) ? 'active' : ''}`}
                        onClick={() => toggleCategory(category)}
                    >
                        {category}
                    </button>
                ))}

                {availableCategories.length === 0 && (
                    <span className="home-chip-placeholder">No categories available right now.</span>
                )}
            </div>

            {/* Event Feed */}
            <div className="home-feed">
                {loading ? (
                    <div className="home-loading">
                        <div className="home-spinner" />
                        <p>Loading events...</p>
                        {(backendSlow || authLoading) && (
                            <div className="home-backend-slow-banner">
                                <span>⏳</span>
                                <span>The server is waking up from sleep — this can take up to 60 seconds on the free plan. Please wait…</span>
                            </div>
                        )}
                    </div>
                ) : filteredEvents.length === 0 ? (
                    <div className="home-empty">
                        {/* Name the query back. "No events found" alone leaves you guessing whether the
                            search matched nothing or the feed is genuinely empty. */}
                        <p>{queryTokens.length ? <>No events match “{searchQuery}”</> : 'No events found'}</p>
                        <button
                            className="btn-link"
                            onClick={() => {
                                // Reset exactly what the label promises, and ALL of it. "Clear filters"
                                // used to leave the date dropdown untouched, so on any day with nothing
                                // scheduled — most days — the button was a dead end: press it, still
                                // "No events found", press it again, same. The date is a filter too.
                                if (queryTokens.length) {
                                    setSearchQuery('');
                                } else {
                                    setSelectedCategories([]);
                                    setDateFilter('all');
                                }
                            }}
                        >
                            {queryTokens.length ? 'Clear search' : 'Clear filters'}
                        </button>
                    </div>
                ) : (
                    filteredEvents.map(ev => (
                        <EventCard
                            key={ev.id}
                            event={ev}
                            isReminderEnabled={reminderEventIds.has(String(ev.id))}
                            onToggleReminder={handleToggleReminder}
                        />
                    ))
                )}

                {loadingMore && (
                    <div className="home-loading-more">
                        <div className="home-spinner" />
                        <p>Loading more events...</p>
                    </div>
                )}

                {!loading && initialLoaded && !hasMore && filteredEvents.length > 0 && (
                    <div className="home-end-message" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem 1rem', color: 'var(--text-secondary)' }}>
                        <CheckCircle size={48} color="#2e7d32" style={{ marginBottom: '12px' }} />
                        <h3 style={{ margin: '0 0 4px 0', color: 'var(--text-primary)' }}>You're all caught up!</h3>
                        <p style={{ margin: 0, fontSize: '0.95rem' }}>You've seen all the upcoming events.</p>
                    </div>
                )}

                <div ref={sentinelRef} className="home-scroll-sentinel" aria-hidden="true" />
            </div>
            </>)}
        </div>
    );
};

export default Home;
