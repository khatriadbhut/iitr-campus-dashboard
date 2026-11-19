const jwt = require('jsonwebtoken');

/** Thrown when the signature is fine but the session is no longer valid. */
class SessionRevokedError extends Error {
    constructor() {
        super('Session revoked');
        this.name = 'SessionRevokedError';
    }
}

/**
 * THE single place a session token is validated. Every entry point must use this — a second
 * hand-rolled `jwt.verify` elsewhere is how revocation silently stops applying to some routes.
 *
 * Two checks, both mandatory:
 *   1. Signature, with the algorithm pinned to HS256 (how we sign), so no alg-confusion trick applies.
 *   2. REVOCATION. `tv` is stamped at login from the account's token_version; bumping that column
 *      kills every token the account holds. A token with NO `tv` is REJECTED — previously a missing
 *      claim skipped the check entirely, which meant anyone forging a token could opt out of
 *      revocation just by omitting the field, making the kill switch useless against the one
 *      attacker it exists for.
 *
 * Throws jwt's own errors (TokenExpiredError / JsonWebTokenError) or SessionRevokedError.
 */
const verifySession = async (token) => {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });

    if (decoded.tv === undefined) throw new SessionRevokedError();

    const { User } = require('../database/schemas');
    const row = await User.findByPk(decoded.user_id, { attributes: ['token_version'], raw: true });
    if (!row || Number(row.token_version) !== Number(decoded.tv)) throw new SessionRevokedError();

    return decoded;
};

/** Maps an auth failure to its response. Shared so every entry point answers identically. */
const authErrorResponse = (res, error) => {
    if (error.name === 'SessionRevokedError') {
        return res.status(401).json({
            error: 'Session revoked',
            message: 'Your session is no longer valid. Please login again'
        });
    }
    if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
            error: 'Token expired',
            message: 'Your session has expired. Please login again'
        });
    }
    if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
            error: 'Invalid token',
            message: 'Authentication failed'
        });
    }
    return res.status(401).json({
        error: 'Authentication error',
        message: 'Please login to continue'
    });
};

/**
 * Where a session token can arrive from.
 *
 * The cookie is the browser's mechanism and stays the primary one. The Authorization header exists for
 * the Android build: Capacitor serves the bundled app from https://localhost, so every call to the API
 * is cross-SITE and the auth cookie — SameSite=Lax, correctly — is never attached. Rather than
 * loosening the cookie to SameSite=None for every user on the web to accommodate one client, the
 * native app carries its token explicitly.
 *
 * A bearer token is not a CSRF risk the way a cookie is: a browser attaches cookies to cross-site
 * requests automatically, but no page can set an Authorization header on a cross-origin request
 * without our CORS policy agreeing to it first. Accepting the header is strictly the safer half.
 *
 * The cookie wins when both are present, so a stale header in a browser tab cannot shadow a fresh
 * session.
 */
const readToken = (req) => {
    const cookieToken = req.cookies?.auth_token;
    if (cookieToken) return cookieToken;

    const header = req.headers?.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(String(header).trim());
    return match ? match[1].trim() : null;
};

/**
 * Middleware to check if user is authenticated
 * Verifies the JWT from the auth_token cookie, or an Authorization: Bearer header (native app).
 */
const userLoggedIn = async (req, res, next) => {
    try {
        const token = readToken(req);

        if (!token) {
            return res.status(401).json({
                error: 'No authentication token found',
                message: 'Please login to continue'
            });
        }

        req.user = await verifySession(token);
        next();
    } catch (error) {
        console.error('Auth error:', error);
        return authErrorResponse(res, error);
    }
};

/**
 * Middleware to verify user and attach user info to request
 * Verifies JWT from auth_token cookie and attaches decoded user to req.user
 * Internally uses userLoggedIn middleware
 */
const { touchPresence } = require('./presence');

const userData = (req, res, next) => {
    // userLoggedIn already verifies the JWT and attaches req.user
    userLoggedIn(req, res, (err) => {
        if (err) return next(err);
        // Only AFTER a verified session, so presence can never be set by an unauthenticated caller.
        touchPresence(req, res, next);
    });
};

module.exports = { userLoggedIn, userData, verifySession, authErrorResponse, SessionRevokedError, readToken };
