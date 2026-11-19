/**
 * Central structured logger (pino). One logger for the whole app.
 *  - Level from LOG_LEVEL (default: info in prod, debug elsewhere) → dial verbosity without code changes.
 *  - JSON to stdout → Docker ships it straight to CloudWatch, searchable/filterable.
 *  - redact: NEVER log secrets (auth header, cookies, tokens, passwords) even if an object carrying them
 *    is logged by mistake.
 * Use logger.info/warn/error/debug across the app instead of console.*.
 */
const pino = require('pino');

const logger = pino({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    redact: {
        paths: [
            'req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]',
            '*.password', '*.token', '*.access_token', '*.refresh_token', '*.jwt', '*.secret',
        ],
        remove: true,
    },
    base: { service: 'campus-dashboard-api' },
});

module.exports = logger;
