/**
 * When does an event start and end?
 *
 * One definition, because three separate copies of this calculation existed and each got a different
 * part of it wrong:
 *
 *   · Home.jsx had TWO implementations that disagreed with each other — one honouring an academic
 *     calendar row's explicit end, one not.
 *   · Calendar.jsx had a third spelling, in date-strings rather than milliseconds.
 *   · routes/event.js had a SQL fourth that considered only the start, so a four-day fest dropped out
 *     of the feed the morning after it began.
 *
 * The reason it keeps going wrong is that an event records its end in one of two ways, and whoever
 * writes the expression next has to remember both:
 *
 *   database events        tentative_start_time + duration_minutes
 *   academic calendar rows an explicit end date, and NO duration at all
 *
 * Compute start+duration for an academic row and you get the start back, so a ten-day exam period
 * looks like a ten-minute one.
 */

// 'YYYY-MM-DD' with no time is parsed by Date as UTC midnight, which is the PREVIOUS day for anyone
// west of UTC — an event would drop a day early. Parse a bare date as local midnight instead.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const parseLocal = (value, endOfDay = false) => {
    if (!value) return NaN;
    const s = String(value);
    const iso = DATE_ONLY.test(s) ? `${s}T${endOfDay ? '23:59:59' : '00:00:00'}` : s;
    return new Date(iso).getTime();
};

/** Milliseconds at which the event begins. NaN when it has no usable start. */
export function eventStartMs(ev) {
    if (!ev) return NaN;
    return parseLocal(ev.tentative_start_time || ev.raw_start);
}

/**
 * Milliseconds at which the event is over.
 *
 * An explicit end always wins — that is the only thing an academic calendar row has. Otherwise the
 * end is start + duration, and an event with neither ends when it starts, which is the correct
 * reading of "we were told a time and nothing else".
 */
export function eventEndMs(ev) {
    if (!ev) return NaN;
    const explicit = ev.tentative_end_time || (ev.isAcademicCalendar ? ev.raw_end : null);
    if (explicit) {
        const t = parseLocal(explicit, true);
        if (Number.isFinite(t)) return t;
    }
    const start = eventStartMs(ev);
    if (!Number.isFinite(start)) return NaN;
    return start + (Number(ev.duration_minutes) || 0) * 60000;
}

/** Is the event still running, or finished within `graceMs`? */
export function isEventLive(ev, graceMs = 0, now = Date.now()) {
    const end = eventEndMs(ev);
    return Number.isFinite(end) ? end >= now - graceMs : true;   // unknown end → keep, never hide silently
}

/**
 * Should the feed still carry this event? It stays until the END OF THE DAY it finished on.
 *
 * A fixed grace period was the obvious spelling and the wrong one. With one hour, an event that ended
 * at 10am was gone by 11am — so selecting the "Today" filter in the afternoon showed nothing that had
 * happened that morning, even though the filter's whole promise is "today". Anchoring to the local day
 * boundary instead means the feed reads the way a person reads a day: everything from today, then what
 * is coming. It is also self-limiting — at most one day of finished events can ever accumulate, unlike
 * a rolling window, which stacks up exactly when the feed is busiest.
 *
 * Local midnight, not UTC: the viewer's day is the one that matters, and IST is UTC+5:30, so a
 * UTC-based boundary would drop the morning's events at 5:30am.
 */
export function isEventOnFeed(ev, now = Date.now()) {
    const end = eventEndMs(ev);
    if (!Number.isFinite(end)) return true;                       // unknown end → keep, never hide silently
    const d = new Date(now);
    const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return end >= startOfToday;
}

/**
 * How long an event runs, phrased the way a person would say it.
 *
 * Anything spanning a day or more is counted in DAYS. A three-day trek was rendering as "71h 59m",
 * which is arithmetically true and useless — nobody plans around seventy-two hours, they plan around
 * three days. The minute-level remainder is an artifact of how a multi-day span is stored (midnight to
 * 23:59 on the last day), so rounding to the nearest day is the honest reading, not a loss of detail.
 *
 * `suffix` exists because the two call sites want different phrasing: the calendar chip is tight on
 * space ("3 Days") while the detail page reads as a sentence ("3 Days Duration").
 */
export function durationLabel(mins, suffix = '') {
    if (!mins) return '';
    const tail = suffix ? ` ${suffix}` : '';
    if (mins >= 1440) {
        const days = Math.round(mins / 1440);
        return `${days} Day${days > 1 ? 's' : ''}${tail}`;
    }
    if (mins < 60) return `${mins} Mins${tail}`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return (m ? `${h}h ${m}m` : `${h} Hour${h > 1 ? 's' : ''}`) + tail;
}

/** Does the event overlap [fromMs, toMs)? The test a date-range filter actually wants. */
export function eventOverlaps(ev, fromMs, toMs) {
    const start = eventStartMs(ev);
    const end = eventEndMs(ev);
    if (!Number.isFinite(start)) return true;                     // undated → never filtered out by a window
    return start < toMs && (Number.isFinite(end) ? end : start) >= fromMs;
}
