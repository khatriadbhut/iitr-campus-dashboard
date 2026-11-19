import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { mutate } from 'swr';
import { Clock, MapPin, CalendarDays, Bell, BellRing, Share2, Pointer, ClipboardList } from 'lucide-react';
import { shareEvent, shareEventOnWhatsApp } from '../../services/shareEvent';
import todoService from '../../services/todo';
import WhatsAppIcon from '../Icons/WhatsAppIcon';
import ReminderBell from './ReminderBell';
import { notify } from '../../services/notify';
import { safeCssUrl } from '../../utils/safeUrl';
import './EventCard.css';

// Deterministic gradient per event id/name
const GRADIENTS = [
    'linear-gradient(145deg, #713364 0%, #4a1d3f 100%)',
    'linear-gradient(145deg, #8e4b7e 0%, #713364 100%)',
    'linear-gradient(145deg, #4a1d3f 0%, #1a1518 100%)',
    'linear-gradient(145deg, #5c2851 0%, #713364 100%)',
    'linear-gradient(145deg, #713364 0%, #FFD700 100%)',
];

const CATEGORY_COLORS = {
    Technical: '#713364',
    Cultural: '#e91e63',
    Sports: '#ff9800',
    Academic: '#8B6914',
    Fest: '#f44336',
    Holiday: '#2e7d32',
    Exam: '#c62828',
    'Timetable Reschedule': '#d84315',
    Deadline: '#b26a00',            // amber — matches the Calendar agenda's deadline colour
    General: '#607d8b',
};

// All-day is decided by the CALLER, from the is_all_day/isAllDay flag — never inferred here.
// This used to return 'ALL DAY' when the string contained 'T00:00:00', but the timestamp arrives in
// UTC: 00:00Z is 05:30 IST, so a genuine early-morning event (the 5:30 AM Cyclothon departure) lost
// its time and rendered as all-day. The flag is set at publish time from whether a start time was
// extracted at all, which is the only thing that actually knows.
const formatTime = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

// LOCAL calendar day, not toISOString(). IST is UTC+5:30, so an all-day event stored at local midnight
// converts to 18:30 UTC the PREVIOUS day — "Today" never matched for any midnight-start item, and a
// holiday (or a deadline with no closing time) rendered as "Fri, 14 Aug" while a timed item on the very
// same day correctly said "Today". Same-day comparisons must be done in the viewer's own timezone.
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const formatRelativeDate = (dateStr, isShort = false) => {
    const eventDate = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const eventDay = localDay(eventDate);
    const todayDay = localDay(today);
    const tomorrowDay = localDay(tomorrow);

    if (eventDay === todayDay) return 'Today';
    if (eventDay === tomorrowDay) return 'Tomorrow';

    if (isShort) return eventDate.getDate();
    
    return eventDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' });
};

const formatEventDateRange = (startTime, durationMinutes) => {
    const startDate = new Date(startTime);
    if (!durationMinutes || durationMinutes <= 1440) {
        const endDateObj = new Date(startDate.getTime() + (durationMinutes || 0) * 60000);
        if (startDate.getDate() === endDateObj.getDate()) {
            return formatRelativeDate(startTime);
        }
    }
    
    const endDate = new Date(startDate.getTime() + (durationMinutes || 0) * 60000);
    
    const startDay = startDate.getDate();
    const endDay = endDate.getDate();
    const startMonth = startDate.toLocaleDateString('en-IN', { month: 'short' });
    const endMonth = endDate.toLocaleDateString('en-IN', { month: 'short' });

    if (localDay(startDate) === todayDay() ) {
         // handle relatively if needed, but for range 18-19 Apr is clearer
    }

    if (startMonth === endMonth) {
        return `${startDay}-${endDay} ${startMonth}`;
    }
    
    return `${startDay} ${startMonth} - ${endDay} ${endMonth}`;
};

const todayDay = () => localDay(new Date());

// What to print where the location goes. These are four DIFFERENT states and must never collapse:
//   online   → "Online". It happens on Meet/Zoom/Teams; there is no room and there never will be.
//   tba      → "Venue to be announced". A real room exists, it just is not decided yet — so a student
//              knows to come to campus and watch for a follow-up. Saying "Online" here would send them
//              to a link that does not exist; saying "Online" for a tba event is the mix-up to avoid.
//   physical → the room itself.
//   unknown  → "Location TBA": the email never mentioned a venue at all. Deliberately worded the same
//              as it always has been, because it is a gap in our information, not a stated promise.
export const locationLabel = (event) => {
    const mode = event?.venue_mode;
    const named = event?.location_name || event?.venue_text || event?.venue;
    if (mode === 'online') return 'Online';
    if (mode === 'tba') return 'Venue to be announced';
    if (named) return named;
    return 'Location TBA';
};

const EventCard = ({ event, isReminderEnabled = false, onToggleReminder }) => {
    const navigate = useNavigate();

    const isAcademic = event.isAcademicCalendar;
    const isTodo = event.isTodoEvent;
    // A notice's apply-by date borrowing the feed on the day it falls due. Renders as a NORMAL event
    // card (notice.deadline is date-only — no time is ever stored, so it is always an all-day item
    // running to end of day); only the tap target and share link differ, since it opens the notice.
    const isDeadline = event.isDeadlineItem;
    const isSlimFormat = isAcademic || isTodo;

    const numericId = typeof event.id === 'string' ? parseInt(event.id.replace(/\D/g, '')) || event.id.length : event.id;
    const fallbackGradient = GRADIENTS[(numericId || 0) % GRADIENTS.length];
    
    const safeBg = safeCssUrl(event.image_url);   // '' unless a real http(s) image URL
    const bannerStyle = safeBg
        ? {
            background: `linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.7)), ${safeBg}`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }
        : { background: fallbackGradient };

    const categoryList = Array.isArray(event.categories)
        ? event.categories.map((item) => (typeof item === 'string' ? item : item?.name)).filter(Boolean)
        : (typeof event.categories === 'string'
            ? event.categories.split(',').map((item) => item.trim()).filter(Boolean)
            : []);

    const primaryCategory = categoryList.length > 0 ? categoryList[0] : 'General';

    const categoryColor = CATEGORY_COLORS[primaryCategory] || '#607d8b';

    // Allow setting reminders for all events, including all-day ones (they will trigger the night before at 11:30 PM)
    const canSetReminder = Boolean(event?.tentative_start_time);

    const handleReminderClick = (evt) => {
        evt.stopPropagation();
        if (!canSetReminder || !onToggleReminder) return;
        onToggleReminder(event);
    };

    const handleShareClick = async (evt) => {
        evt.stopPropagation();
        const result = await shareEvent(event);
        if (result.method === 'clipboard') {
            notify('Event link copied to clipboard.');
        }
    };

    const handleWhatsAppShare = (evt) => {
        evt.stopPropagation();
        shareEventOnWhatsApp(event);
    };

    // 'idle' | 'saving' | 'added'. The button used to fire an unguarded create on every press, so a
    // double-tap sent two requests before either returned. `saving` closes that window; `added` stops
    // the card offering an action whose only effect now is a no-op on the server.
    // Seeded from the feed: an event already on the user's todo list opens in the 'added' state, so
    // the button tells the truth after a reload instead of only within the session that added it.
    const [todoState, setTodoState] = useState(event.onTodoList ? 'added' : 'idle');

    const handleAddToTodo = async (evt) => {
        evt.stopPropagation();
        if (todoState !== 'idle') return;
        setTodoState('saving');
        try {
            let localDate = null;
            let localTime = null;
            if (event.tentative_start_time) {
                const d = new Date(event.tentative_start_time);
                localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                localTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            }

            const res = await todoService.create({
                text: isDeadline ? `Apply for ${event.name || 'this'}` : `Attend ${event.name || 'Event'}`,
                notes: event.description ? event.description.substring(0, 200) + (event.description.length > 200 ? '...' : '') : null,
                due_date: localDate,
                due_time: localTime,
                linked_event_id: (isAcademic || isDeadline) ? null : numericId, // Only link if it's a real event with an ID
                linked_event_name: event.name,
                linked_event_club: event.club_name || primaryCategory,
                linked_event_date: event.tentative_start_time
            });
            setTodoState('added');
            // The feed derives `onTodoList` from the `cal_todos` SWR key, and creating a todo does not
            // tell that key anything — so the PERSONAL/TODO badge did not appear until something else
            // happened to refetch, which in practice meant a reload. Revalidate here and the badge and
            // the gold rule land on the card immediately. Calendar reads the same key, so it follows too.
            mutate('cal_todos');
            // The server is idempotent and reports whether this already existed, so say which
            // happened rather than claiming to have added something twice.
            notify(res?.alreadyExists
                ? 'Already on your Assistant Todo list.'
                : 'Task added to your Assistant Todo list!');
        } catch (err) {
            console.error('Failed to add to Todo', err);
            setTodoState('idle');   // let them retry — a failure is not an 'added' state
            notify('Failed to add to Todo list. Please try again.');
        }
    };

    return (
        <div
                className={`event-card-new ${isTodo ? 'todo-event-card' : ''} ${event.onTodoList ? 'on-todo-list' : ''}`}
                onClick={() => isTodo ? navigate('/todo') : isDeadline ? navigate(`/notices/${event.noticeId}`) : navigate(`/event/${event.id}`)}
            style={{ cursor: 'pointer' }}
        >
            {/* Slim Header actions for Academic & Todo */}
            {isSlimFormat && (
                <div style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '8px', zIndex: 3 }}>
                    {!isTodo && (
                        <button
                            type="button"
                            className={`event-reminder-btn event-reminder-btn--academic`}
                            aria-label={todoState === 'added' ? 'Already on your todo list' : 'Add to Todo'}
                            onClick={handleAddToTodo}
                            disabled={todoState !== 'idle'}
                            title={todoState === 'added' ? 'Already on your Assistant Task List' : 'Add to Assistant Task List'}
                            style={{ position: 'static', opacity: todoState === 'added' ? 0.45 : 1 }}
                        >
                            <ClipboardList size={14} />
                        </button>
                    )}
                    <ReminderBell
                        event={event}
                        enabled={isReminderEnabled}
                        onToggle={onToggleReminder}
                        canSet={canSetReminder}
                        size={14}
                    />
                </div>
            )}

            {/* Banner - Only for non-academic/non-todo events */}
            {!isSlimFormat && (
                <div className="event-card-banner" style={bannerStyle}>
                    {event.onTodoList && (
                        <span className="event-category-badge todo-flag-badge">PERSONAL/TODO</span>
                    )}
                    <span className="event-category-badge" style={{ background: categoryColor }}>
                        {primaryCategory}
                    </span>
                    <div style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '8px' }}>
                        <button
                            type="button"
                            className={`event-reminder-btn`}
                            aria-label={todoState === 'added' ? 'Already on your todo list' : 'Add to Todo'}
                            onClick={handleAddToTodo}
                            disabled={todoState !== 'idle'}
                            title={todoState === 'added' ? 'Already on your Assistant Task List' : 'Add to Assistant Task List'}
                            style={{ position: 'static', opacity: todoState === 'added' ? 0.45 : 1 }}
                        >
                            <ClipboardList size={15} />
                        </button>
                        <ReminderBell
                            event={event}
                            enabled={isReminderEnabled}
                            onToggle={onToggleReminder}
                            canSet={canSetReminder}
                            size={15}
                            className="event-reminder-btn"
                        />
                    </div>
                </div>
            )}

            {/* Body */}
            <div className="event-card-body">
                {/* Slim header for academic/todo cards to show category and color code */}
                {isSlimFormat && (
                    <div className="academic-card-header">
                        {/* Grouped: .academic-card-header is justify-content: space-between, so two loose
                            children fly to opposite ends and the second lands under the action icons.
                            The badges belong together on the left as one row. */}
                        <div className="academic-badge-group">
                            <span className="academic-badge" style={{ background: `${categoryColor}15`, color: categoryColor, borderColor: categoryColor }}>
                                {primaryCategory}
                            </span>
                            {/* A gold rule down the edge is a hint, not a label — nobody meeting it for
                                the first time can tell what it means. Say it. Sits BESIDE the category
                                badge because the card is still a Holiday (or a Talk, or an Exam); being
                                on the todo list is an additional fact about it, not what it is.
                                Wording matches the PERSONAL/TODO tag on standalone todo cards and on
                                the calendar, so the same idea reads the same everywhere. */}
                            {event.onTodoList && (
                                <span className="academic-badge todo-flag-badge">PERSONAL/TODO</span>
                            )}
                        </div>
                    </div>
                )}

                <h3 className="event-card-title">
                    {(event.status === 'cancelled' || event.status === 'rescheduled') && (
                        <span className={`event-status-badge event-status-badge--${event.status}`}>
                            {event.status === 'cancelled' ? 'Cancelled' : 'Rescheduled'}
                        </span>
                    )}
                    {event.name}
                </h3>

                <div className="event-club-avatar" style={isSlimFormat ? { background: categoryColor, color: 'white' } : { overflow: 'hidden' }}>
                    {event.club_logo_url || event.logo_url ? (
                        <img src={event.club_logo_url || event.logo_url} alt={event.club_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                        (event.club_name || 'U').charAt(0).toUpperCase()
                    )}
                </div>

                <div className="event-card-meta">
                    <span className="event-meta-item">
                        <CalendarDays size={13} />
                        {formatEventDateRange(event.tentative_start_time, event.duration_minutes)}
                    </span>
                    <span className="event-meta-item">
                        <Clock size={13} />
                        {event.is_all_day || event.isAllDay ? 'ALL DAY' : formatTime(event.tentative_start_time)}
                    </span>
                    <span className="event-meta-item">
                        <MapPin size={13} />
                        {locationLabel(event)}
                    </span>
                </div>

                {!isSlimFormat && (
                    <div className="event-card-footer">
                        <button
                            type="button"
                            className="event-share-btn event-share-btn--bottom event-share-btn--whatsapp"
                            aria-label="Share on WhatsApp"
                            onClick={handleWhatsAppShare}
                            title="Share on WhatsApp"
                        >
                            <WhatsAppIcon size={14} />
                        </button>
                        <button
                            type="button"
                            className="event-share-btn event-share-btn--bottom event-share-btn--icon"
                            aria-label="Share event"
                            onClick={handleShareClick}
                            title="Share event"
                        >
                            <Share2 size={14} />
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default EventCard;
