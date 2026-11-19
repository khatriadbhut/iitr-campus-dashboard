import React, { useState } from 'react';
import { ClipboardList } from 'lucide-react';
import ReminderBell from '../Event/ReminderBell';
import { mutate } from 'swr';
import todoService from '../../services/todo';
import { notify } from '../../services/notify';

/**
 * The add-to-todo and reminder buttons for a NOTICE, matching the pair on an event card.
 *
 * Deliberately reuses EventCard's `event-reminder-btn` classes rather than inventing a notice-only
 * style: these are the same two affordances doing the same two jobs, and a student should not have to
 * learn them twice.
 *
 * The reminder id is `notice-<id>`, NOT the bare notice id, and that prefix is load-bearing.
 * eventReminders treats any PURELY NUMERIC id as server-persistable and POSTs it to the events
 * reminder API — so a bell on notice 251 would have written a reminder against EVENT 251, a different
 * item entirely. The prefix makes it non-numeric, so it is kept local exactly like an academic-calendar
 * entry, while still appearing on the reminder hub at /notifications.
 */
const NoticeActions = ({ notice, isReminderEnabled, onToggleReminder, onTodoList }) => {
    // 'idle' | 'saving' | 'added' — same guard as the event card, for the same reason: an unguarded
    // handler fires twice on a double-tap, before either request returns.
    const [todoState, setTodoState] = useState(onTodoList ? 'added' : 'idle');

    // A reminder needs a moment to fire before, and a notice with neither a deadline nor an event date
    // has none. The bell is still RENDERED and simply disabled, because that is what an event card does
    // when it has no start time ("Reminders unavailable"). Hiding it instead made the row of actions
    // change shape from card to card, so a notice looked like it was missing a feature rather than
    // like the feature had nothing to act on.
    const when = notice.deadline || notice.event_date || null;
    const canSetReminder = Boolean(when);
    const reminderEvent = canSetReminder
        ? {
            id: `notice-${notice.id}`,
            name: notice.title,
            tentative_start_time: `${when}T${notice.deadline_time || notice.time_start || '09:00'}:00`,
            club_name: notice.club_name || null,
            location_name: notice.venue || null,
        }
        : null;

    const handleAddToTodo = async (evt) => {
        evt.stopPropagation();
        if (todoState !== 'idle') return;
        setTodoState('saving');
        try {
            const res = await todoService.create({
                // A notice is something you act on by a date, so the task reads as the action.
                text: `Apply for ${notice.title || 'this notice'}`,
                notes: notice.body ? notice.body.slice(0, 200) + (notice.body.length > 200 ? '...' : '') : null,
                due_date: when,
                due_time: notice.deadline_time || notice.time_start || null,
                // linked_event_id is for EVENTS. A notice id here would point the task at an unrelated
                // event row, so the link is carried by name only.
                linked_event_id: null,
                linked_event_name: notice.title,
                linked_event_club: notice.club_name || null,
                linked_event_date: when,
            });
            setTodoState('added');
            // Home and Calendar both derive "already on your list" from this key; without the
            // revalidation the badge would not appear until something else happened to refetch.
            mutate('cal_todos');
            notify(res?.alreadyExists
                ? 'Already on your Assistant Todo list.'
                : 'Task added to your Assistant Todo list!');
        } catch (err) {
            console.error('Failed to add notice to Todo', err);
            setTodoState('idle');       // a failure is not an 'added' state — let them retry
            notify('Failed to add to Todo list. Please try again.');
        }
    };

    const handleReminder = (evt) => {
        evt.stopPropagation();
        if (!canSetReminder || !onToggleReminder) return;
        onToggleReminder(reminderEvent);
    };

    return (
        <div className="notice-actions" onClick={(e) => e.stopPropagation()}>
            <button
                type="button"
                className="event-reminder-btn event-reminder-btn--academic"
                aria-label={todoState === 'added' ? 'Already on your todo list' : 'Add to Todo'}
                title={todoState === 'added' ? 'Already on your Assistant Task List' : 'Add to Assistant Task List'}
                onClick={handleAddToTodo}
                disabled={todoState !== 'idle'}
                style={{ position: 'static', opacity: todoState === 'added' ? 0.45 : 1 }}
            >
                <ClipboardList size={14} />
            </button>
            {/* Same control as the event card. A notice's reminder is now server-persisted too, so
                the timing picker applies here identically — see services/noticeReminders.js. */}
            <ReminderBell
                event={reminderEvent}
                enabled={isReminderEnabled}
                onToggle={onToggleReminder}
                canSet={canSetReminder}
                size={14}
                title={!canSetReminder
                    ? 'Reminders unavailable — this notice has no date'
                    : 'Remind me before the deadline'}
            />
        </div>
    );
};

export default NoticeActions;
