import React, { useState, useMemo } from 'react';
import { Clock, MapPin, ChevronRight, ChevronLeft, Calendar as CalendarIcon, List as ListIcon } from 'lucide-react';
import { useNavigate } from 'react-router';
import useSWR from 'swr';
import eventService from '../services/events';
import academicCalendarService from '../services/academicCalendar';
import noticesService from '../services/notices';
import todoService from '../services/todo';
import { locationLabel } from '../components/Event/EventCard';
import { useAuth } from '../context/AuthContext';
import './Calendar.css';
import { eventStartMs, eventEndMs, durationLabel } from '../utils/eventTime';

// The chip list is DERIVED from the events actually on screen, never hardcoded — see the useMemo
// below. The old hardcoded array carried 'Technical', 'Cultural' and 'Sports', none of which is a
// real category: the six in `event_category` are 'Talks & Lectures', 'Competitions & Hackathons',
// 'Workshops & Courses', 'Recruitments & PORs', 'Sports & Fitness' and 'Cultural & Fests', and the
// filter below compares with ===. So those three chips could never match anything, and — worse —
// there was no chip for ANY of the six, meaning a real club event was unfilterable here except via
// 'All'. Home already derives its chips from the data (see availableCategories in Home.jsx); this
// now does the same, so a category added to the config can never leave a dead chip behind.

const CATEGORY_COLORS = {
    // the six real event categories
    'Talks & Lectures': '#713364',
    'Competitions & Hackathons': '#00695c',
    'Workshops & Courses': '#1565c0',
    'Recruitments & PORs': '#6a1b9a',
    'Sports & Fitness': '#ff9800',
    'Cultural & Fests': '#e91e63',
    // academic-calendar day kinds and the two synthetic feeds
    Academic: '#8B6914',
    Fest: '#f44336',
    Holiday: '#2e7d32', // Green for holidays
    Exam: '#c62828',    // Red for exams
    'Timetable Reschedule': '#d84315', // Orange/Deep for rescheduled days
    Deadline: '#b26a00', // Amber for notice/apply deadlines
    'Personal/Todo': '#d4af37', // Gold for personal tasks
    General: '#607d8b',
};

// `categories` arrives in three shapes depending on which feed built the item: a comma-joined string
// from the events API, an array of {name} rows, or a single synthetic label ('Deadline',
// 'Personal/Todo', or an academic-calendar kind). One reader for all three, so the chip list and the
// filter can never disagree about what an item is tagged with.
const catsOf = (ev) => {
    const c = ev?.categories;
    if (!c) return [];
    if (Array.isArray(c)) return c.map((x) => String(x?.name ?? x).trim()).filter(Boolean);
    return String(c).split(',').map((x) => x.trim()).filter(Boolean);
};

// Helper to get YYYY-MM-DD in LOCAL time
const getLocalDateString = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// The calendar grid works in local date STRINGS, but "when does this end" is the same question the
// feed asks — so it comes from the one definition rather than a fourth spelling of it. This copy used
// to compute start+duration for every non-academic event and read raw_start/raw_end for academic ones,
// which is right, but it is the kind of right that only stays right if someone remembers to keep three
// files in step. See src/utils/eventTime.js.
const getEventBounds = (ev) => {
    const start = eventStartMs(ev);
    const end = eventEndMs(ev);
    // An unparseable date would render as "NaN-aN-aN" and match no day cell. Returning nulls lets the
    // caller skip it instead, which is what it already does for a row it cannot place.
    if (!Number.isFinite(start)) return { st: null, en: null };
    return {
        st: getLocalDateString(new Date(start)),
        en: getLocalDateString(new Date(Number.isFinite(end) ? end : start)),
    };
};

const formatTime = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Every day of the given month, for the roster strip.
//
// This used to be a fixed FOURTEEN days from an anchor, and the anchor was only ever moved by the
// month navigator, which set it to the 1st. So the roster showed days 1-14 and the back half of every
// month was simply unreachable — no scroll, no paging, no way to get to the 20th. Fourteen dates back
// to the first frontend commit, where the strip was pinned to today and never moved at all; making it
// anchor-driven later left the 14 in place without anyone revisiting what it meant.
//
// The strip now spans the month the navigator is on, exactly like the grid, so both views answer the
// same question and every day of the month is reachable. It scrolls horizontally (cal-week-strip).
const buildMonthStrip = (viewDate) => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const last = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: last }, (_, i) => new Date(year, month, i + 1));
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CalendarPage = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [viewDate, setViewDate] = useState(new Date()); // For month navigation
    const [activeCategory, setActiveCategory] = useState('All');
    const [viewMode, setViewMode] = useState('grid'); // 'strip' or 'grid'

    const weekDays = useMemo(() => buildMonthStrip(viewDate), [viewDate]);

    // The window to fetch: the visible month, plus 31 days of lead-in so a multi-day event that
    // STARTED before the 1st still spans into view (getEventBounds spans it). Both views now show the
    // same month, so one window serves both — when the strip was 14 days from its own anchor it could
    // run past the month end and those days went unfetched.
    const range = useMemo(() => {
        const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
        const from = new Date(first); from.setDate(from.getDate() - 31);
        const to = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1);
        return { from: getLocalDateString(from), to: getLocalDateString(to) };
    }, [viewDate]);

    // Was `eventService.getAllEvents()` with NO arguments, which defaults to page 1 / limit 10 against
    // an oldest-first endpoint — so the calendar only ever held the ten OLDEST events in the database
    // and showed nothing current. Invisible on a small dev DB, total on a real one. It is now a windowed
    // fetch keyed on the month, so paging to another month refetches instead of reusing that one cache
    // entry for all of time.
    const { data: dynamicEvents = [], isLoading: loadDyn } = useSWR(
        user !== undefined ? `cal_dynamic_${range.from}_${range.to}` : null,
        () => eventService.getEventsInRange(range.from, range.to)
    );

    const { data: rawAcademicEvents = [], isLoading: loadAcad } = useSWR(
        user !== undefined ? 'cal_academic' : null,
        () => academicCalendarService.getAllEvents()
    );

    // The PDF's own teaching-day totals. Null for layouts we cannot parse (some Spring/MBA formats),
    // in which case the tile hides rather than showing a number from a previous semester.
    const { data: teachingDays = null } = useSWR(
        user !== undefined ? 'cal_teaching_days' : null,
        () => academicCalendarService.getTeachingDays()
    );
    // UG I year starts later and so has its own, smaller total.
    const isUgFirstYear = Number(user?.current_year) === 1;

    const { data: rawTodos = [] } = useSWR(
        user !== undefined && localStorage.getItem('iitr_show_feed_todos') === 'true' ? 'cal_todos' : null,
        () => todoService.getAll()
    );

    // Notices with a deadline — surfaced in the AGENDA list on their due date (NOT in the grid cells).
    const { data: rawNotices = {} } = useSWR(
        user !== undefined ? 'cal_notices' : null,
        () => noticesService.getNotices()
    );

    const loading = loadDyn || loadAcad;

    const events = useMemo(() => {
        const normalizedAcademic = rawAcademicEvents.map(ae => ({
            id: `academic-${ae.id}`,
            name: ae.title,
            tentative_start_time: ae.startDate + 'T00:00:00',
            tentative_end_time: ae.endDate + 'T23:59:59',
            raw_start: ae.startDate,
            raw_end: ae.endDate,
            description: ae.description,
            categories: ae.category,
            location_name: ae.isHoliday ? 'Campus Holiday' : 'Departments',
            isAcademicCalendar: true,
            isAllDay: true,
            // Same as the feed: the API names the club for the few fest rows that have one.
            club_id: ae.clubId ?? undefined,
            club_name: ae.clubName || 'IIT Roorkee',
        }));

        const activeTodos = rawTodos.filter(t => !t.completed);
        const todoData = activeTodos.map(todo => {
            const todayStr = new Date().toISOString().split('T')[0];
            const dateStr = todo.due_date || todayStr;
            const timeStr = todo.due_time || '00:00';
            
            return {
                id: `todo-${todo.id}`,
                name: todo.text,
                tentative_start_time: `${dateStr}T${timeStr}:00`,
                description: todo.notes,
                categories: 'Personal/Todo',
                location_name: todo.linked_event_name || 'Personal Task',
                isTodoEvent: true,
                isAllDay: !todo.due_time,
                club_name: user?.full_name || 'Personal',
            };
        });

        return [...dynamicEvents, ...normalizedAcademic, ...todoData];
    }, [dynamicEvents, rawAcademicEvents, rawTodos, user]);

    // Deadline items — kept SEPARATE from `events` so they appear in the agenda but never colour a grid
    // cell or add a grid dot (per design: deadlines show under the calendar, not inside its layout).
    //
    // WHY NOTICES BELONG ON A CALENDAR AT ALL (settled 2026-08-25, after being removed and put back):
    // the obvious reading is "the calendar is for events, notices live on the Notices tab" — that is
    // what got them deleted once. It is backwards. EVENTS are the thing a student already hears about
    // from their club; a scholarship closing or a form due on the 14th is precisely what they would
    // otherwise have to go and look for. Putting the deadline on the date is most of the value of
    // having a calendar. Do not remove these again without a reason that answers that.
    //
    // Club preferences deliberately do NOT filter these (see visibleEvents): a notice deadline is not
    // a club's event, and hiding a fee deadline because someone un-followed a club would be a bug.
    const deadlineItems = useMemo(() => {
        return (rawNotices.notices || [])
            .filter((n) => n.deadline)
            .map((n) => ({
                id: `deadline-${n.id}`,
                noticeId: n.id,
                name: n.title,
                tentative_start_time: `${n.deadline}T${n.deadline_time || '00:00'}:00`,
                raw_start: n.deadline,
                raw_end: n.deadline,
                categories: 'Deadline',
                location_name: n.venue || undefined,
                venue_mode: n.venue_mode || null,
                description: n.body,
                isDeadline: true,
                isAllDay: !n.deadline_time,      // a stated closing time shows as the real time, not "ALL DAY"
                club_name: n.club_name || 'Institute',   // real organiser; `source` is stripped by the API
                link: n.link,
            }));
    }, [rawNotices]);

    // Events for the selected date (using local comparison)
    const selectedDateStr = getLocalDateString(selectedDate);
    const todayStr = getLocalDateString(new Date());

    // Chips come from what is actually loaded, so every chip is guaranteed to match something and no
    // real category can be missing one. Built off the WHOLE list rather than the selected day, so the
    // row doesn't reshuffle as you click through dates.
    // Hidden clubs were never filtered here at all — un-following a club removed its events from the
    // feed but they stayed on the calendar, which is the same setting appearing to half-work.
    // Deliberately NOT applied to todos or deadlines: a personal task and a notice deadline are not a
    // club's event, and dropping them because of a club preference would lose something the student
    // asked for by name.
    const notPreferredClubIds = useMemo(
        () => new Set((user?.notPreferredClubs || []).map((id) => Number(id))),
        [user?.notPreferredClubs]
    );
    // Counted from the served semester's own entries, so a re-import moves it without a code change.
    // Was hardcoded to 12 while the calendar held 11.
    const holidayCount = useMemo(
        () => rawAcademicEvents.filter((ae) => ae.isHoliday).length,
        [rawAcademicEvents]
    );

    const visibleEvents = useMemo(
        () => events.filter((ev) => (
            ev.isTodoEvent || ev.isDeadline
            || ev.club_id === undefined
            || !notPreferredClubIds.has(Number(ev.club_id))
        )),
        [events, notPreferredClubIds]
    );

    const categoryFilters = useMemo(() => {
        const set = new Set();
        for (const ev of [...visibleEvents, ...deadlineItems]) catsOf(ev).forEach((c) => set.add(c));
        return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
    }, [visibleEvents, deadlineItems]);

    // A chip can disappear when the data changes (e.g. the only Fest item drops out of range). Fall
    // back to 'All' by DERIVING it during render rather than correcting state in an effect — an
    // effect here would setState on every such render and cascade.
    const effectiveCategory = categoryFilters.includes(activeCategory) ? activeCategory : 'All';

    const dayEvents = useMemo(() => {
        return [...visibleEvents, ...deadlineItems].filter(ev => {
            const { st, en } = getEventBounds(ev);
            const matchDate = selectedDateStr >= st && selectedDateStr <= en;

            // Match ANY of the event's categories, not just the first. An event carrying
            // "Workshops & Courses,Cultural & Fests" was previously reachable only under Workshops —
            // its second category could never be filtered to. The colour badge still uses the primary.
            const matchCat = effectiveCategory === 'All' || catsOf(ev).includes(effectiveCategory);

            return matchDate && matchCat;
        }).sort((a, b) => new Date(a.tentative_start_time) - new Date(b.tentative_start_time));
    }, [visibleEvents, deadlineItems, selectedDateStr, effectiveCategory]);

    // Mark which dates have events (using local comparison)
    const dateDotMap = useMemo(() => {
        const map = {};
        // Check ONLY the days displayed in the strip
        weekDays.forEach(d => {
            const dStr = getLocalDateString(d);
            const hasEvent = visibleEvents.some(ev => {
                const { st, en } = getEventBounds(ev);
                return dStr >= st && dStr <= en;
            });
            if (hasEvent) map[dStr] = true;
        });
        return map;
    }, [visibleEvents, weekDays]);

    const formattedDate = selectedDate.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric'
    }).toUpperCase();

    // Month Grid Logic
    const getDaysInMonth = (year, month) => {
        const date = new Date(year, month, 1);
        const days = [];

        while (date.getDay() !== 0) {
            date.setDate(date.getDate() - 1);
        }

        const firstDayOfGrid = new Date(date);
        const nextMonth = new Date(year, month + 1, 1);

        let current = new Date(firstDayOfGrid);
        while (current < nextMonth || current.getDay() !== 0 || days.length === 0) {
            days.push(new Date(current));
            current.setDate(current.getDate() + 1);
            if (days.length >= 42) break;
        }

        return days;
    };

    const monthDays = useMemo(() => {
        return getDaysInMonth(viewDate.getFullYear(), viewDate.getMonth());
    }, [viewDate]);

    const changeMonth = (offset) => {
        const next = new Date(viewDate.getFullYear(), viewDate.getMonth() + offset, 1);
        setViewDate(next);
        setSelectedDate(next);
    };

    // Pre-calculate event map for grid (using local comparison)
    const monthEventMap = useMemo(() => {
        const map = {};
        visibleEvents.forEach(ev => {
            const { st, en } = getEventBounds(ev);
            const startArr = st.split('-').map(Number);
            const endArr = en.split('-').map(Number);

            let curr = new Date(startArr[0], startArr[1] - 1, startArr[2]);
            const stop = new Date(endArr[0], endArr[1] - 1, endArr[2]);

            while (curr <= stop) {
                const k = getLocalDateString(curr);
                if (!map[k]) map[k] = new Set();
                // ALL categories, so a day still gets its dot when you filter by a secondary one.
                const cs = catsOf(ev);
                if (cs.length) cs.forEach((c) => map[k].add(c)); else map[k].add('General');
                curr.setDate(curr.getDate() + 1);
            }
        });
        return map;
    }, [visibleEvents]);

    return (
        <div className="calendar-page-new">
            {/* Header */}
            <div className="page-header-bar">
                <h1>Calendar</h1>
                <div className="page-header-actions">
                    <div className="calendar-view-toggle" role="group" aria-label="Choose calendar view">
                        <button
                            className={`calendar-view-toggle-btn ${viewMode === 'strip' ? 'active' : ''}`}
                            onClick={() => setViewMode('strip')}
                            aria-label="Roster View"
                            aria-pressed={viewMode === 'strip'}
                        >
                            <ListIcon size={16} />
                            <span>Roster View</span>
                        </button>
                        <button
                            className={`calendar-view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                            onClick={() => setViewMode('grid')}
                            aria-label="Grid View"
                            aria-pressed={viewMode === 'grid'}
                        >
                            <CalendarIcon size={16} />
                            <span>Grid View</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Month Header / Nav */}
            <div className="cal-view-header">
                <div className="cal-month-switcher" role="group" aria-label="Month navigator">
                    <button aria-label="Previous month" onClick={() => changeMonth(-1)}><ChevronLeft size={20} /></button>
                    <div className="cal-month-label">
                        {viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </div>
                    <button aria-label="Next month" onClick={() => changeMonth(1)}><ChevronRight size={20} /></button>
                </div>
            </div>

            {viewMode === 'strip' ? (
                <div className="cal-week-strip">
                    {weekDays.map((d, i) => {
                        const dStr = getLocalDateString(d);
                        const isSelected = dStr === selectedDateStr;
                        const isToday = dStr === todayStr;
                        const hasDot = dateDotMap[dStr];
                        return (
                            <button
                                key={i}
                                // The strip is a whole month now, so it is wider than the screen and
                                // opens scrolled to the 1st — which on the 25th means today is off to
                                // the right and the view looks empty. Nudge the selected day into the
                                // middle. `ref` fires on mount and whenever selection moves.
                                ref={isSelected ? (el) => el?.scrollIntoView({ block: 'nearest', inline: 'center' }) : undefined}
                                className={`cal-day-chip ${isSelected ? 'selected' : ''} ${isToday && !isSelected ? 'today' : ''}`}
                                onClick={() => {
                                    setSelectedDate(new Date(d));
                                    setViewDate(new Date(d));
                                }}
                            >
                                <span className="cal-day-name-label">{DAY_NAMES[d.getDay()]}</span>
                                <span className="cal-day-num">{d.getDate()}</span>
                                {hasDot && <span className="cal-event-dot-marker" />}
                            </button>
                        );
                    })}
                </div>
            ) : (
                <div className="cal-grid-container">
                    <div className="cal-grid-weekdays">
                        {DAY_NAMES.map(day => <span key={day}>{day[0]}</span>)}
                    </div>
                    <div className="cal-grid">
                        {monthDays.map((d, i) => {
                            const dStr = getLocalDateString(d);
                            const isSelected = dStr === selectedDateStr;
                            const isToday = dStr === todayStr;
                            const isCurrentMonth = d.getMonth() === viewDate.getMonth();
                            const dayCats = Array.from(monthEventMap[dStr] || []);
                            const isRescheduled = dayCats.includes('Timetable Reschedule');
                            const isWeekend = d.getDay() === 0 || (d.getDay() === 6 && !isRescheduled);
                            const isHoliday = dayCats.includes('Holiday') || isWeekend;
                            const isExam = dayCats.includes('Exam');

                            return (
                                <div
                                    key={i}
                                    className={`cal-grid-day ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''} ${!isCurrentMonth ? 'other-month' : ''} ${isHoliday ? 'holiday' : ''} ${isExam ? 'exam' : ''}`}
                                    onClick={() => setSelectedDate(new Date(d))}
                                >
                                    <span className="cal-grid-date">{d.getDate()}</span>
                                    <div className="cal-grid-indicators">
                                        {dayCats.slice(0, 3).map((cat, idx) => (
                                            <span
                                                key={idx}
                                                className="cal-grid-dot"
                                                style={{ background: CATEGORY_COLORS[cat] || '#607d8b' }}
                                            />
                                        ))}
                                        {dayCats.length > 3 && <span className="cal-grid-more">+</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="cal-category-chips">
                {categoryFilters.map(c => (
                    <button
                        key={c}
                        className={`home-chip ${effectiveCategory === c ? 'active' : ''}`}
                        onClick={() => setActiveCategory(c)}
                    >
                        {c}
                    </button>
                ))}
            </div>

            <div className="cal-date-heading">
                <span className="cal-date-label">{formattedDate}</span>
                {dayEvents.length > 0 && (
                    <span className="cal-event-count">{dayEvents.length} EVENT{dayEvents.length > 1 ? 'S' : ''}</span>
                )}
            </div>

            <div className="cal-timeline">
                {loading ? (
                    <div className="home-loading"><div className="home-spinner" /><p>Loading...</p></div>
                ) : dayEvents.length === 0 ? (
                    <div className="cal-empty">
                        <p>No events on this day</p>
                        <span>Try a different date or category</span>
                    </div>
                ) : (
                    dayEvents.map((ev, idx) => {
                        // Badge shows the primary; catsOf also survives the array shape, which a bare
                        // .split() on this line did not.
                        const primaryCat = catsOf(ev)[0] || 'General';
                        const catColor = CATEGORY_COLORS[primaryCat] || '#607d8b';
                        return (
                            <div key={ev.id} className="cal-timeline-item" onClick={() => ev.isTodoEvent ? navigate(`/todo`) : ev.isDeadline ? navigate(`/notices/${ev.noticeId}`) : ev.isAcademicCalendar ? null : navigate(`/event/${ev.id}`)}>
                                <div className="cal-time-col">
                                    <span className="cal-time">
                                        {ev.is_all_day || ev.isAllDay ? 'ALL DAY' : formatTime(ev.tentative_start_time)}
                                    </span>
                                    <div className="cal-timeline-line" />
                                    <div className="cal-timeline-dot" style={{ background: catColor }} />
                                </div>

                                <div className="cal-event-card">
                                    <div className="cal-event-cat-badge" style={{ background: `${catColor}18`, color: catColor }}>
                                        {primaryCat}
                                    </div>
                                    <h4 className="cal-event-title">{ev.name}</h4>
                                    {ev.club_name && (
                                        <div className="cal-event-club-row">
                                            <div className="cal-club-dot" />{ev.club_name}
                                        </div>
                                    )}
                                    <div className="cal-event-foot">
                                        {(ev.location_name || ev.venue_mode) && (
                                            <span><MapPin size={12} />{locationLabel(ev)}</span>
                                        )}
                                        {ev.duration_minutes && (
                                            <span><Clock size={12} />{durationLabel(ev.duration_minutes)}</span>
                                        )}
                                    </div>
                                    <ChevronRight size={16} className="cal-event-arrow" />
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Both of these were hardcoded — 70 and 12, typed into the JSX and never updated. The 70
                was not invented: it is the real total from an OLDER calendar PDF, left behind when the
                semester moved on. The 12 was simply wrong; this semester has 11 holidays, which the
                page itself was already showing one screen up.
                Now: holidays counted from the entries, teaching days read from whatever PDF was last
                uploaded. Upload a new calendar and both follow it. */}
            <div className="cal-metrics-row">
                {teachingDays?.others != null && (
                    <div className="cal-metric-card">
                        <span className="cal-metric-val">
                            {isUgFirstYear && teachingDays.ugFirstYear != null ? teachingDays.ugFirstYear : teachingDays.others}
                        </span>
                        <span className="cal-metric-label">Total Teaching Days</span>
                    </div>
                )}
                <div className="cal-metric-card">
                    <span className="cal-metric-val">{holidayCount}</span>
                    <span className="cal-metric-label">Public Holidays</span>
                </div>
            </div>

        </div>
    );
};

export default CalendarPage;
