/**
 * Ordering for the Notices feed. Pure (no DB, no models) so it can be unit-tested — the route it used
 * to live in cannot be imported without opening a database connection.
 *
 * WHY THIS EXISTS: the feed sorted "important first, then nearest deadline". A past deadline is the
 * nearest one there is, so EXPIRED notices ranked highest of all. Measured against prod on 2026-08-22,
 * the first TWELVE notices served were every one of them expired — a July fee-waiver extension, a
 * recruitment that closed three weeks earlier — so the top of the tab was a graveyard and anything
 * actionable sat underneath it.
 *
 * Expired now sinks below everything regardless of priority. It SORTS rather than filters: nothing
 * disappears, so a reader can still scroll back to an old item.
 */

// The deadline column is DATEONLY ("YYYY-MM-DD") and means end-of-day IST, so compare against the
// current IST date rather than UTC — otherwise everything expires five and a half hours early.
function istToday(now = Date.now()) {
    return new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);
}

// "until further notice" / "applicable from…" items set open_ended and must never expire.
function isExpired(n, today = istToday()) {
    if (!n || n.open_ended) return false;
    if (!n.deadline) return false;
    return String(n.deadline).slice(0, 10) < today;
}

function compareNotices(a, b, today = istToday()) {
    const rank = (n) => (isExpired(n, today) ? 2 : n.priority === 'important' ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    // Inside the expired band the MOST RECENTLY closed is the most relevant → newest first.
    if (isExpired(a, today) && isExpired(b, today)) return String(b.deadline).localeCompare(String(a.deadline));
    // LIVE ITEMS: NEWEST FIRST.
    //
    // This used to be "soonest deadline first", which made the tab nearly STATIC: the same handful of
    // closing-soon items camped at the top for days while genuinely new notices appeared underneath
    // them. That is the opposite of what a feed is for — someone opening it wants to know what has
    // arrived since they last looked, and a notice they have already scrolled past twice does not
    // become more interesting by staying put.
    //
    // Urgency is not lost, it is carried by three things that are better at it than sort order: the
    // pinned IMPORTANT band above (which this comparator still honours), the deadline chip that turns
    // amber at a week and red at two days, and the Closing-today / this-week filters. Sort order was
    // the weakest of the four and the only one that cost the feed its chronology.
    //
    // A dateless notice is no longer pushed to the bottom either: with nothing to close, its arrival
    // IS its relevance, so it takes its place in the timeline like everything else.
    return new Date(b.published_at || 0) - new Date(a.published_at || 0);
}

module.exports = { istToday, isExpired, compareNotices };
