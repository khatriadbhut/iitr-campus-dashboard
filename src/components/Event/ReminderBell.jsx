import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, BellRing } from 'lucide-react';
import eventReminderService from '../../services/eventReminders';
import { notify } from '../../services/notify';
import './ReminderBell.css';

/** The choices, in the order they read. 5m is kept as an option but is no longer the default —
 *  five minutes before a talk in MAC Auditorium arrives too late to leave your room. */
/**
 * Which picker is open, held OUTSIDE React.
 *
 * It cannot live in component state: turning a reminder on makes the feed re-render and the card
 * REMOUNTS (verified — the button's DOM node is a different object afterwards), which would destroy
 * the state and close the panel the instant it opened. An external store survives that, so the bell
 * can do the natural thing: switch the reminder on at the default and show the choices.
 *
 * One id, because only one picker should ever be open at a time.
 */
let openId = null;
const openListeners = new Set();
const setOpenId = (id) => { openId = id; openListeners.forEach((l) => l()); };
const subscribeOpen = (l) => { openListeners.add(l); return () => openListeners.delete(l); };

const OPTIONS = [
    { minutes: 5, label: '5m' },
    { minutes: 15, label: '15m' },
    { minutes: 30, label: '30m' },
    { minutes: 60, label: '1h' },
];

/**
 * The bell on an event or notice, plus the timing picker that opens with it.
 *
 * Replaces the old arrangement where the bell was on/off here and the timings could only be changed
 * on a separate Reminders page — a screen most people never opened, holding the only control for a
 * setting they might actually want. Now the decision to care about something and the decision when
 * to be nudged happen in the same place.
 *
 * Turning the bell ON opens the picker and applies the default (30m). Unticking the last remaining
 * time turns the reminder off entirely, which is what unticking everything visibly means.
 */
const ReminderBell = ({
    event,
    enabled = false,
    onToggle,
    canSet = true,
    size = 14,
    className = 'event-reminder-btn event-reminder-btn--academic',
    title,
}) => {
    const key = String(event?.id ?? '');
    const currentOpen = useSyncExternalStore(subscribeOpen, () => openId);
    const open = currentOpen === key && key !== '';
    const setOpen = useCallback((v) => setOpenId(v ? key : null), [key]);

    const [offsets, setOffsets] = useState([]);
    const [busy, setBusy] = useState(false);
    const wrapRef = useRef(null);

    // Read the current selection straight from the service rather than threading it through every
    // caller — three separate render paths in EventCard use this, plus the notice card.
    const readOffsets = useCallback(() => {
        const entry = eventReminderService.getReminderEntries().find((r) => String(r.id) === String(event?.id));
        setOffsets(Array.isArray(entry?.offsetsMinutes) ? entry.offsetsMinutes : []);
    }, [event?.id]);

    useEffect(() => { if (enabled) readOffsets(); }, [enabled, readOffsets]);

    // Close on outside click or Escape. A popover you can only dismiss by hitting the same small
    // target again is a trap on a phone.
    useEffect(() => {
        if (!open) return undefined;
        const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        window.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    /**
     * The bell ONLY opens the picker. It deliberately does not enable anything.
     *
     * The obvious design — enable on click, then show the choices — cannot work here: toggling a
     * reminder makes the feed re-render and the card REMOUNTS, which throws away this component's
     * own state, so the panel closed the instant it opened. Verified in the browser: the button's
     * DOM node is a different object after the toggle.
     *
     * Opening is a pure local state change, so nothing remounts and the panel stays put. Choosing a
     * time is what turns the reminder on — which is also one less step than tap-then-choose.
     */
    const handleBell = async (e) => {
        e.stopPropagation();
        if (!canSet) return;
        if (open) { setOpen(false); return; }

        if (!enabled) {
            // Switch it on at the default (30m) and show the choices with that already selected, so
            // one tap is a working reminder and the picker is there only if you want to change it.
            setBusy(true);
            try {
                const result = await onToggle?.(event);
                if (result?.error) {
                    notify(result.error === 'event-started'
                        ? 'That event has already started'
                        : 'Could not set that reminder');
                    return;
                }
                readOffsets();
            } finally { setBusy(false); }
        }
        setOpen(true);
    };

    const applyOffsets = async (next) => {
        // First pick on an un-belled item: turn it on, which applies the default, then set the
        // chosen times over the top.
        if (!enabled && next.length > 0) {
            setBusy(true);
            setOffsets(next);
            try {
                // These RESOLVE with { error } rather than throwing — an event that has already
                // started comes back { enabled: false, error: 'event-started' }. Ignoring the return
                // value made the chip look selected while nothing was ever written, anywhere.
                const toggled = await onToggle?.(event);
                if (toggled?.error) throw new Error(toggled.error);
                const set = await eventReminderService.setReminderOffsets(event, next);
                if (set?.error) throw new Error(set.error);
                readOffsets();
            } catch (err) {
                setOffsets([]);
                notify(err?.message === 'event-started'
                    ? 'That event has already started'
                    : 'Could not set that reminder');
            } finally { setBusy(false); }
            return;
        }

        // Unticking the last time means "stop reminding me", not "remind me at no time at all".
        if (next.length === 0) {
            setBusy(true);
            try {
                const off = await onToggle?.(event);
                if (off?.error) throw new Error(off.error);
                setOffsets([]);
                setOpen(false);
            } catch {
                notify('Could not turn that reminder off');
            } finally { setBusy(false); }
            return;
        }
        const previous = offsets;
        setOffsets(next);                      // optimistic; the chips must feel instant
        setBusy(true);
        try {
            const result = await eventReminderService.setReminderOffsets(event, next);
            if (result?.error) throw new Error(result.error);
            readOffsets();
        } catch {
            setOffsets(previous);
            notify('Could not update reminder timing');
        } finally { setBusy(false); }
    };

    const toggleOffset = (minutes) => {
        const has = offsets.includes(minutes);
        applyOffsets(has ? offsets.filter((m) => m !== minutes) : [...offsets, minutes].sort((a, b) => b - a));
    };

    return (
        <span className="reminder-bell-wrap" ref={wrapRef} onClick={(e) => e.stopPropagation()}>
            <button
                type="button"
                className={`${className} ${enabled ? 'enabled' : ''}`}
                aria-label={enabled ? 'Reminder timing' : 'Remind me about this'}
                aria-expanded={open}
                title={title || (canSet ? 'Remind me' : 'Reminders unavailable')}
                onClick={handleBell}
                disabled={!canSet || busy}
                style={{ position: 'static' }}
            >
                {enabled ? <BellRing size={size} /> : <Bell size={size} />}
            </button>

            {open && (
                <span className="reminder-bell-pop" role="group" aria-label="Remind me before">
                    <span className="reminder-bell-pop-title">Remind me before</span>
                    <span className="reminder-bell-chips">
                        {OPTIONS.map((o) => {
                            const on = offsets.includes(o.minutes);
                            return (
                                <button
                                    key={o.minutes}
                                    type="button"
                                    className={`reminder-chip${on ? ' is-on' : ''}`}
                                    aria-pressed={on}
                                    disabled={busy}
                                    onClick={(e) => { e.stopPropagation(); toggleOffset(o.minutes); }}
                                >
                                    {o.label}
                                </button>
                            );
                        })}
                    </span>
                    {enabled && <button
                        type="button"
                        className="reminder-bell-off"
                        disabled={busy}
                        onClick={(e) => { e.stopPropagation(); applyOffsets([]); }}
                    >
                        Turn off
                    </button>}
                </span>
            )}
        </span>
    );
};

export default ReminderBell;
