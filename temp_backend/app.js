require('dotenv').config();

const logger = require('./utils/logger');
const sentry = require('./utils/sentry');
sentry.initSentry();                       // opt-in; no-op without SENTRY_DSN

// ── Crash safety ─────────────────────────────────────────────────────────────
// Last-resort handlers so a stray error dies CLEANLY — logged (pino) + alerted (Sentry) + flushed —
// then exits, so Docker's restart brings a FRESH process. Never a silent death or half-alive zombie.
const crash = (label) => async (errOrReason) => {
    logger.fatal({ err: errOrReason }, `${label} — exiting for a clean restart`);
    sentry.captureException(errOrReason);
    await sentry.flush();
    process.exit(1);
};
process.on('uncaughtException', crash('uncaughtException'));
process.on('unhandledRejection', crash('unhandledRejection'));

// ── Fail-closed boot guards (production) ─────────────────────────────────────
// Refuse to start on a dangerous misconfiguration, rather than run insecurely.
if (process.env.NODE_ENV === 'production') {
    if (process.env.DEV_LOGIN === 'true') {
        logger.fatal('DEV_LOGIN=true in production — refusing to start (auth backdoor). Unset it.');
        process.exit(1);
    }
    if (!process.env.JWT_SECRET) {
        logger.fatal('JWT_SECRET is not set in production — refusing to start.');
        process.exit(1);
    }
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const bodyParser = require("body-parser");
const cookieParser = require('cookie-parser');
// const sql = require('./database/connection.js');
const { sequelize } = require('./database/schemas');
const initializeSchema = require('./database/initializeSchema.js');
const { recordSecurityEvent, ACTIONS } = require('./utils/activityLog');

// SECURITY: Require rate limiting (can be installed with: npm install express-rate-limit)
// Placeholder - if not installed, create a simple pass-through middleware
let rateLimit;
try {
    rateLimit = require('express-rate-limit');
} catch (e) {
    console.warn('express-rate-limit not installed. Rate limiting disabled. Install with: npm install express-rate-limit');
    // Pass-through middleware
    rateLimit = () => (req, res, next) => next();
}

const app = express();
const PORT = process.env.PORT || 8081;

// Trust proxies so secure cookies work behind them, and so req.ip is the real client.
//
// The hop count is environment-specific and getting it wrong is silent: on the EC2 the chain is
// CloudFront -> nginx -> node (2 hops), so a value of 1 made req.ip resolve to a CloudFront EDGE
// address. Every student in India routes through a handful of edges, which turned the per-IP write
// limiter below into a single global bucket. Self-hosted docker-compose is nginx -> node (1 hop).
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1));

const normalizeOrigin = (value = '') => value.trim().replace(/\/$/, '');

const allowedOrigins = [
    ...(process.env.FRONTEND_URL || '').split(','),
    ...(process.env.CORS_ALLOWED_ORIGINS || '').split(','),
]
    .map(normalizeOrigin)
    .filter(Boolean);

const allowedOriginSet = new Set(allowedOrigins);

const allowedOriginRegexes = (process.env.CORS_ALLOWED_ORIGIN_REGEX || '')
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .flatMap((pattern) => {
        try {
            return [new RegExp(pattern, 'i')];
        } catch (error) {
            console.warn(`Invalid CORS regex skipped: ${pattern}`);
            return [];
        }
    });

const allowVercelPreviews = process.env.ALLOW_VERCEL_PREVIEWS !== 'false';
const vercelPreviewRegex = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;
const localOriginRegex = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (curl/server-to-server/health checks)
        if (!origin) return callback(null, true);

        const normalizedOrigin = normalizeOrigin(origin);

        if (localOriginRegex.test(normalizedOrigin)) {
            return callback(null, true);
        }

        if (allowVercelPreviews && vercelPreviewRegex.test(normalizedOrigin)) {
            return callback(null, true);
        }

        if (allowedOriginSet.has(normalizedOrigin)) {
            return callback(null, true);
        }

        if (allowedOriginRegexes.some((regex) => regex.test(normalizedOrigin))) {
            return callback(null, true);
        }

        return callback(new Error(`Not allowed by CORS: ${normalizedOrigin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(cookieParser());
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));  // structured request log (skip health noise)

// ── Content-Type gate on state-changing requests ─────────────────────────────
// A cross-site <form> can only send text/plain, application/x-www-form-urlencoded or
// multipart/form-data. Those are "simple requests": no CORS preflight, so the browser sends them (and
// the cookie) without ever asking us for permission. That is exactly the shape that made the CSRF
// finding work — bodyParser.json ignores text/plain, req.body comes out {}, and a handler needing no
// body proceeds happily.
//
// Requiring application/json forces a preflight, which CORS then refuses for an unknown origin. This
// is a THIRD independent layer under the Origin/Referer check and SameSite=Lax; each can fail alone.
// multipart is allowed only where a file genuinely arrives (the academic-calendar PDF import), and
// that route is admin-gated and still covered by the other two layers.
// Image upload replaced the old browser→ImgBB path; a file genuinely arrives here, and both routes
// are admin-gated (routes/upload.js) and still covered by the Origin/Referer and SameSite layers.
const MULTIPART_ALLOWED = [/^\/academic-calendar\/import\//, /^\/upload\/(poster|logo)$/];
app.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!ct) return next();                                   // bodyless DELETE/POST — nothing to mis-parse
    if (ct === 'application/json') return next();
    if (ct === 'multipart/form-data' && MULTIPART_ALLOWED.some((re) => re.test(req.path))) return next();
    return res.status(415).json({
        error: 'Unsupported Media Type',
        message: 'This endpoint accepts application/json.',
    });
});

app.use(bodyParser.json({ limit: '1mb' }));   // cap body size (memory-DoS guard)

// HTTP Parameter Pollution: ?id=1&id=2 makes Express hand a handler an ARRAY where it expects a string,
// which turns into type-confusion bugs and 500s rather than a breach. Low risk here (query params are
// pagination and filters) but it costs one line — keep the last value, which is what handlers assume.
app.use(require('hpp')());

// Serve ingested event posters (club-email attachments). Static, public-readable images only.
app.use('/uploads', require('express').static(require('path').join(__dirname, 'uploads')));
app.use(
    bodyParser.urlencoded({
        extended: true,
        limit: '1mb',
    })
);

// Probe detection. Sits after the body parsers so it can see what was actually sent, and before the
// routes so it sees every request. It only WRITES A LOG — nothing is blocked, and nothing about the
// request changes. See utils/threatDetect.js for why blocking on these patterns would be worse.
app.use(require('./middlewares/threatLog').threatLog);

// SECURITY headers via helmet (maintained standard set). NO CSP here — this is a JSON API; the SPA's CSP
// is set at CloudFront on the HTML document (where it actually protects the app). frameguard DENY +
// nosniff + HSTS + referrer-policy + hides X-Powered-By. (Reviewed w/ ChatGPT: split is correct.)
app.use(helmet({
    contentSecurityPolicy: false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
}));

// SECURITY FIX: Origin/Referer-Based CSRF Protection
app.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        // Fallback to Referer if Origin is absent
        const sourceOrigin = req.headers.origin || req.headers.referer;

        if (!sourceOrigin) {
            return res.status(403).json({
                error: 'CSRF validation failed',
                message: 'Origin or Referer header is missing.'
            });
        }

        let normalizedOrigin = normalizeOrigin(sourceOrigin);
        
        // If referer was used, extract just the origin part
        if (normalizedOrigin.startsWith('http')) {
            try {
                const url = new URL(normalizedOrigin);
                normalizedOrigin = normalizeOrigin(url.origin);
            } catch (e) {
                // Invalid URL
            }
        }

        let isAllowed = false;
        
        if (localOriginRegex.test(normalizedOrigin)) {
            isAllowed = true;
        } else if (allowVercelPreviews && vercelPreviewRegex.test(normalizedOrigin)) {
            isAllowed = true;
        } else if (allowedOriginSet.has(normalizedOrigin)) {
            isAllowed = true;
        } else if (allowedOriginRegexes.some((regex) => regex.test(normalizedOrigin))) {
            isAllowed = true;
        }

        if (!isAllowed) {
            return res.status(403).json({
                error: 'CSRF validation failed',
                message: 'Cross-site request blocked by Origin validation.'
            });
        }
    }
    next();
});

// SECURITY: Add rate limiting if available
if (rateLimit && rateLimit.toString() !== 'function () { return (req, res, next) => next(); }') {
    // Stricter limit for auth endpoints. Only FAILED attempts count
    // (skipSuccessfulRequests), so a normal login never consumes quota.
    // Note the whole campus shares one public IP behind IITR's NAT, so this
    // bucket is effectively campus-wide — keep the window short.
    const authLimiter = rateLimit({
        windowMs: 5 * 60 * 1000,
        max: 5,
        message: 'Too many login attempts, please try again later.',
        // A tripped auth limiter is the clearest automated-abuse signal the app has, so it is
        // recorded with its IP for the admin security view. Genuine failures only — the cheap
        // state-mismatch rejections never reach the counter (see requestWasSuccessful below).
        handler: (req, res, _next, options) => {
            recordSecurityEvent(req, { action: ACTIONS.RATE_LIMITED, detail: { limiter: 'auth' } });
            res.status(options.statusCode).send(options.message);
        },
        skipSuccessfulRequests: true,
        // A state-mismatch 403 must NOT count, and counting it was itself the vulnerability.
        //
        // /oauth/token clears the oauth_state cookie the moment the callback arrives, so ANY second
        // request to that URL 403s — a reload, a back-button, a browser prefetch. That made five
        // unauthenticated `curl`s enough to exhaust this bucket, and since the whole campus shares
        // one NAT address (see the note above), it blocked login for every student behind it, for
        // five minutes, repeatably. No credentials needed.
        //
        // Exempting them costs no protection. There is no password on these endpoints — Channel-i
        // authenticates — and the state check runs BEFORE any outbound call, so these are cheap to
        // reject. The oauth_state cookie is httpOnly, so it cannot be forged into a match either.
        // Genuine failures still count: a token exchange that 5xxs DID reach channeli.in and is
        // worth rate limiting.
        requestWasSuccessful: (req, res) => res.statusCode < 400 || res.locals.oauthCheapReject === true,
        standardHeaders: true,
        legacyHeaders: false,
    });

    // Key on the logged-in user, falling back to IP only for unauthenticated traffic.
    //
    // Per-IP alone is the wrong primitive here: the entire institute shares one public address
    // behind campus NAT, so 100 writes/15min was a budget for all 8,000 students combined. A
    // student setting up (following four clubs, two reminders) spends ~6-10 writes, so roughly a
    // dozen people onboarding at once would lock out everyone else — on launch day, with no
    // attacker involved. Every user here is authenticated via Channel-i, so we know who they are.
    //
    // Signature is verified but token_version is NOT checked: this runs before auth middleware and
    // must stay cheap (no DB). A revoked-but-unexpired token still gets its own bucket, which is
    // harmless — the request is rejected downstream regardless.
    const jwtLib = require('jsonwebtoken');
    const rateLimitKey = (req) => {
        try {
            const decoded = jwtLib.verify(req.cookies?.auth_token || '', process.env.JWT_SECRET, { algorithms: ['HS256'] });
            if (decoded?.user_id) return `u:${decoded.user_id}`;
        } catch { /* not logged in, or a bad token — fall through to IP */ }
        return `ip:${req.ip}`;
    };

    // General write limiter: protects mutating endpoints without throttling normal page reads
    const writeLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 100,
        keyGenerator: rateLimitKey,
        handler: (req, res, _next, options) => {
            recordSecurityEvent(req, { action: ACTIONS.RATE_LIMITED, detail: { limiter: 'write' } });
            res.status(options.statusCode).send(options.message);
        },
        message: 'Too many requests, please try again in a few minutes.',
        standardHeaders: true,
        legacyHeaders: false,
    });

    // The tester credential is the one password in the system, so it gets its own bucket rather than
    // sharing the Channel-i one. Two reasons it is separate:
    //
    //   - The Channel-i limiter deliberately exempts cheap state-mismatch rejections. A guest-login
    //     failure is never cheap and must always count.
    //   - Keying on IP alone would let one confused tester behind campus NAT lock the Play reviewer
    //     out. 10 failures per 15 minutes is generous for a human retyping a 25-character passphrase
    //     and irrelevant to an attacker: at 125 bits of entropy, exhausting even a millionth of the
    //     keyspace at this rate takes longer than the universe has existed. The limiter is here to
    //     keep scanners out of the log, not because guessing is a live threat.
    const guestLoginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
        handler: (req, res, _next, options) => {
            recordSecurityEvent(req, { action: ACTIONS.RATE_LIMITED, detail: { limiter: 'guest_login' } });
            res.status(options.statusCode).send(options.message);
        },
        // Successes are free — a reviewer signing in repeatedly on a fresh install must never be
        // throttled. Only the explicit bad-credential path sets this flag (routes/auth.js).
        skipSuccessfulRequests: true,
        requestWasSuccessful: (req, res) => res.locals.guestLoginFailed !== true,
        standardHeaders: true,
        legacyHeaders: false,
    });

    app.use('/oauth/guest-login', guestLoginLimiter);
    app.use('/oauth/login', authLimiter);
    app.use('/oauth/token', authLimiter);
    app.use((req, res, next) => {
        // Skip rate limiting for health checks and all read-only GET traffic.
        if (req.path === '/health' || req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
            return next();
        }

        writeLimiter(req, res, next);
    });
}

// Health check — a cheap DB ping so it reports "can actually SERVE" (200), not just "process alive".
// UptimeRobot pings this every 5 min; 503 if the DB is unreachable. Docker healthcheck uses it too.
app.get('/health', async (req, res) => {
    try {
        await sequelize.query('SELECT 1');
        return res.json({ ok: true });
    } catch (e) {
        logger.error({ err: e }, 'health check: DB unreachable');
        return res.status(503).json({ ok: false });
    }
});

// The Play Store tester account is read-only against shared data. Mounted here, ahead of every
// router, so the rule holds for routes that do not exist yet — see middlewares/guestGuard.js for why
// this is an allowlist rather than a list of things guests may not touch.
app.use(require('./middlewares/guestGuard').guestReadOnly);

// routes
// oauth routes
app.use('/oauth', require('./routes/auth.js'));
//events routes
app.use('/events', require('./routes/event.js'));
// user routes
app.use('/user', require('./routes/user.js'));
// location routes
app.use('/locations', require('./routes/location.js'));
// event category routes
app.use('/event-categories', require('./routes/eventCategory.js'));
// admin routes
app.use('/admins', require('./routes/admin.js'));
// club admin routes
app.use('/club-admins', require('./routes/clubAdmin.js'));
// admin permission routes
app.use('/admin-permissions', require('./routes/adminPermissions.js'));
// academic calendar routes
app.use('/academic-calendar', require('./routes/academicCalendar.js'));

app.use('/ingestion', require('./routes/eventIngestion.js'));
app.use('/notifications', require('./routes/notification.js'));
app.use('/analytics', require('./routes/analytics.js'));
// Clubs routes
app.use('/clubs', require('./routes/club.js'));
// Personal todo routes
app.use('/todos', require('./routes/todo.js'));
// Reminder routes
app.use('/reminders', require('./routes/reminder.js'));
app.use('/notice-reminders', require('./routes/noticeReminder.js'));
// Image upload (posters, club logos) — our own S3, replaces the third-party ImgBB path
app.use('/upload', require('./routes/upload.js'));

app.get('/', async (_, res) => {
    try {
        await sequelize.authenticate();
        res.json({
            status: 'ok',
            database: 'connected',
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Error checking database connectivity:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'Could not verify database connectivity'
        });
    }
});

// ── Terminal error handler ───────────────────────────────────────────────────
// Anything that reaches here — a CORS rejection thrown by the origin callback, a malformed-JSON body from
// body-parser, an over-limit payload, or an unhandled throw in a route — becomes a clean JSON response.
// Never Express's default HTML error page, and never a stack trace / file path to the client; the detail
// is logged server-side under a correlation id. (Closes the info-leak found in the pre-deploy pentest.)
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && /Not allowed by CORS/.test(err.message || '')) {
        return res.status(403).json({ error: 'Cross-origin request blocked' });
    }
    if (err && (err.type === 'entity.parse.failed' || (err instanceof SyntaxError && 'body' in err))) {
        return res.status(400).json({ error: 'Malformed request body' });
    }
    if (err && err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request body too large' });
    }
    const errorId = require('crypto').randomBytes(4).toString('hex');
    logger.error({ err, errorId, path: req.path, method: req.method }, 'unhandled request error');
    res.status(500).json({ error: 'Internal server error', errorId });
});

const startServer = async () => {
    try {
        // Initialize database schema before accepting requests.
        await initializeSchema();

        // Resolve permission names -> ids once, before any request can hit a permission check.
        // Throws if a permission row is missing, so a misconfigured database refuses to start rather
        // than silently 403-ing admins who genuinely hold the permission.
        await require('./utils/permissions').loadPermissionIds();

        // Seed the academic calendar from the legacy file on first boot (idempotent).
        await require('./database/seedAcademicCalendar')();

        // Seed email-ingestion reference data (categories, fests, Institute, sender map).
        await require('./database/seedEventIngestion')();

        // Start the Gmail ingestion poller (no-ops until GMAIL_* env is configured).
        require('./services/eventIngestion/runner').startPolling();

        // Turns state changes (due reminders/todos, newly published items, new proposals) into
        // notification rows. Phase 1: fills the in-app centre only — nothing is pushed to a device
        // yet, so this cannot affect anyone who has not opened the app.
        require('./services/notifications/runner').startNotifications();

        app.listen(PORT, () => {
            console.log(`Listening to Port:${PORT}`);
        });
    } catch (err) {
        console.error('Failed to initialize database:', err);
        process.exit(1);
    }
};

startServer();