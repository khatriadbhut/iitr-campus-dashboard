/**
 * The blast radius of the Play Store tester account.
 *
 * One credential is shared by Google's reviewer and every closed tester, so the guest session is
 * treated as hostile-by-default: it may read the app, and it may write only to rows that belong to
 * itself. Nothing a guest does can be seen by a real student.
 *
 * This is a SECOND line of defence, not the only one. The guest holds no admin permission rows, so the
 * admin routes already refuse it. The guard exists because that protection is implicit — it depends on
 * every future route remembering to gate itself — whereas this is explicit and fails closed: a new
 * route added next month is refused to guests until someone deliberately adds it to the allowlist.
 *
 * ALLOWLIST, never a denylist. A denylist that forgets an entry silently grants access; an allowlist
 * that forgets one merely breaks a feature for guests, loudly, in testing.
 */

const jwt = require('jsonwebtoken');
const { readToken } = require('./userAuth');

/**
 * Fixed row for the tester account. Hard-coded rather than looked up by email so that the identity
 * check below never depends on a database read, and so it can never collide with a Channel-i user id
 * (those are Channel-i's own, far below this range — the same range the dev-login user sits in).
 */
const GUEST_USER_ID = 999000002;

/**
 * Writes a guest is allowed to make. Every one of these routes scopes its query to req.user.user_id,
 * so the guest can only ever touch its own rows — verified route by route, not assumed.
 *
 * Deliberately NOT here: /events, /clubs, /admins, /club-admins, /admin-permissions, /locations,
 * /event-categories, /academic-calendar, /ingestion, /upload, /analytics. Those write data the whole
 * campus sees.
 */
const GUEST_WRITE_ALLOWLIST = [
    /^\/todos(\/|$)/,              // personal to-do list
    /^\/reminders(\/|$)/,          // event reminders, keyed by user
    /^\/notice-reminders(\/|$)/,   // notice reminders, keyed by user
    /^\/notifications(\/|$)/,      // read-receipts, prefs, push subscribe/unsubscribe
    /^\/user\/preferences$/,       // followed clubs / categories
    /^\/oauth\/logout$/,           // must always be able to leave
    /^\/oauth\/guest-login$/,      // re-authenticating with a token still in hand
];

/** Signature-only decode. No database read: this runs on every write, ahead of the auth middleware
 *  that does the full revocation check. A revoked-but-unexpired guest token is still recognised as a
 *  guest here, which is exactly what we want — it gets refused twice instead of once. */
const decodeUnverifiedSession = (req) => {
    try {
        const token = readToken(req);
        if (!token) return null;
        return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
        return null;   // no session, or a bad one — not this middleware's problem
    }
};

/**
 * True for a token belonging to the tester account.
 *
 * Both the claim AND the user id are checked, and either is enough. The claim alone would miss a token
 * minted before the claim existed; the id alone would miss a future second guest account. Neither can
 * be forged without JWT_SECRET, so an OR here costs nothing.
 */
const isGuestSession = (decoded) => decoded?.guest === true || Number(decoded?.user_id) === GUEST_USER_ID;

/**
 * Refuses shared-data writes from the guest account.
 *
 * Mounted globally, before the routers. Reads pass through untouched — the whole point of the tester
 * account is to let a reviewer see the real app with real content.
 */
const guestReadOnly = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    const decoded = decodeUnverifiedSession(req);
    if (!isGuestSession(decoded)) return next();

    // Trailing slashes vary by proxy — CloudFront forwards /api/oauth/token/ with one, the vite dev
    // proxy without. Matching the raw path would make the allowlist depend on which edge served the
    // request, so normalise before comparing.
    const path = req.path.replace(/\/+$/, '') || '/';

    if (GUEST_WRITE_ALLOWLIST.some((pattern) => pattern.test(path))) return next();

    return res.status(403).json({
        error: 'Guest account is read-only',
        message: 'This demo account can browse everything but cannot change shared data. Sign in with Channel-i to make changes.',
    });
};

module.exports = { guestReadOnly, isGuestSession, GUEST_USER_ID, GUEST_WRITE_ALLOWLIST };
