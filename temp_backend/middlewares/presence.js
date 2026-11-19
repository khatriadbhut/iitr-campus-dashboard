const { User } = require('../database/schemas');

/**
 * Records that an authenticated user was here, for the "active now" figure in admin analytics.
 *
 * THROTTLED IN MEMORY, deliberately. The app is read-heavy — a single page view fires several API
 * calls — so writing user.last_seen_at on every request would add a database write to nearly every
 * read, to maintain a number nobody needs more precisely than "within the last minute". The map
 * holds one timestamp per active user and is bounded by the number of people using the app.
 *
 * Fire-and-forget: presence is telemetry, and a failed write must never affect the request that
 * happened to carry it. The catch is empty on purpose — logging it would be noisier than the fact.
 */
const WRITE_EVERY_MS = 60 * 1000;
const lastWrite = new Map();

// The process restarts on every deploy, which clears this. That is harmless: the next request from
// each user simply writes once more than strictly necessary.
const touchPresence = (req, res, next) => {
    const id = req?.user?.user_id;
    if (id) {
        const now = Date.now();
        const prev = lastWrite.get(id) || 0;
        if (now - prev > WRITE_EVERY_MS) {
            lastWrite.set(id, now);
            User.update({ last_seen_at: new Date() }, { where: { user_id: id } }).catch(() => {});
        }
    }
    next();
};

module.exports = { touchPresence };
