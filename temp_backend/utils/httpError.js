/**
 * fail() — the safe way to return a server error. Logs the REAL error (pino) + captures it (Sentry) with a
 * short id, and returns the client only a GENERIC message + that id. So internal detail (DB constraint
 * names, paths, infra hints) never leaks to the browser, but you can still trace it: the user quotes the
 * id, you grep it in the logs.
 */
const logger = require('./logger');
const sentry = require('./sentry');

function fail(res, status, publicMessage, err) {
    const errorId = Math.random().toString(36).slice(2, 10);
    logger.error({ err, errorId, status }, publicMessage);
    if (status >= 500) sentry.captureException(err);          // alert on server errors, not client 4xx
    return res.status(status).json({ error: publicMessage, errorId });
}

module.exports = { fail };
