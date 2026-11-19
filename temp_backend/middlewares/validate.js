/**
 * Joi request validation.
 *
 * joi was already a dependency but was never imported anywhere — every endpoint hand-rolled its own
 * checks, so coverage was inconsistent and malformed input surfaced as a 500 from deep inside a handler
 * instead of a 400 at the edge.
 *
 * Deliberately NOT a security boundary on its own: Sequelize parameterises every query, so this is not
 * what stands between you and injection. It is about consistency and failing early and legibly —
 * OWASP's "validate incoming JSON schemas" (nodebestpractices 6.10, API-Security-Checklist "Input").
 *
 * `stripUnknown` is the part that carries real security weight: fields the schema does not declare are
 * REMOVED rather than passed through, so a caller cannot smuggle an extra column into a handler that
 * spreads req.body into a model write.
 */
const Joi = require('joi');

const OPTS = {
    abortEarly: false,      // report every problem at once, not one per round trip
    stripUnknown: true,     // drop undeclared fields instead of forwarding them
    convert: true,          // "12" -> 12 for params, which arrive as strings
};

const detail = (error) => error.details.map((d) => d.message.replace(/"/g, "'")).join('; ');

/** Validate req.body against a Joi schema. Replaces req.body with the sanitised value. */
const validateBody = (schema) => (req, res, next) => {
    const { error, value } = schema.validate(req.body ?? {}, OPTS);
    if (error) return res.status(400).json({ error: 'Invalid request body', message: detail(error) });
    req.body = value;
    next();
};

/** Validate req.params (route ids). Does NOT reassign req.params — Express 5 makes it read-only. */
const validateParams = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.params ?? {}, OPTS);
    if (error) return res.status(400).json({ error: 'Invalid URL parameter', message: detail(error) });
    next();
};

/** Validate req.query. Same read-only caveat as params. */
const validateQuery = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.query ?? {}, OPTS);
    if (error) return res.status(400).json({ error: 'Invalid query parameter', message: detail(error) });
    next();
};

// ── shared building blocks ───────────────────────────────────────────────────
// user_id and club_id are BIGINT in Postgres and arrive as strings or numbers depending on the caller,
// so accept both rather than forcing every call site to agree.
const id = Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().pattern(/^\d+$/));
const idList = Joi.array().items(Joi.number().integer().positive());
const isoDate = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(null, '');
const hhmm = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).allow(null, '');

module.exports = { Joi, validateBody, validateParams, validateQuery, id, idList, isoDate, hhmm };
