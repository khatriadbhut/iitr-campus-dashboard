/**
 * Merge a live event's CURRENT values underneath a reply email's NEW ones, for the Updates card.
 *
 * WHY: a reply ("Updated timing — now 5:30 PM") states only what changed. Reviewed on its own it looks
 * like an almost-empty event, while the original card holds the description and link but the wrong time.
 * The reviewer should approve the FINISHED item, so the card shows both combined.
 *
 * The rule is one-directional: whatever the reply actually said WINS, and the live event only fills in
 * what the reply was silent about. Never the other way round — otherwise a reschedule would be
 * overwritten by the very value it came to correct.
 */

// Empty string / null / undefined all mean "the reply didn't mention this". 0 and false are real values.
const said = (v) => v !== '' && v !== null && v !== undefined;
const keep = (mine, theirs) => (said(mine) ? mine : (theirs ?? ''));

export function mergeTargetIntoDraft(base, cand) {
    if (!cand) return base;
    return {
        ...base,
        title: keep(base.title, cand.name),
        venue: keep(base.venue, cand.venue_text),
        description: keep(base.description, cand.description),
        link: keep(base.link, cand.registration_link),
        club: keep(base.club, cand.club_name),
        startDate: keep(base.startDate, cand.start ? String(cand.start).slice(0, 10) : ''),
        // Categories are a set, not a scalar: an empty selection means "the reply named none", so fall
        // back to whatever the live event already carries rather than clearing it on save.
        categories: (Array.isArray(base.categories) && base.categories.length)
            ? base.categories
            : (cand.categories || []),
    };
}

export default mergeTargetIntoDraft;
