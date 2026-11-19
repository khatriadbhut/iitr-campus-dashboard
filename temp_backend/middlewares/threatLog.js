const { detectThreat } = require('../utils/threatDetect');
const { recordSecurityEvent, ACTIONS, SEVERITY } = require('../utils/activityLog');

/**
 * Logs requests that look like probes. Detection only — the request continues exactly as before.
 *
 * Mounted after the body parsers (so bodies can be inspected) and before the routes.
 *
 * RATE-LIMITED PER ADDRESS, which matters more than it looks: a scanner sends thousands of requests
 * in a burst, and one audit row each would turn the security log into a denial-of-service against
 * itself — the table fills, the page fills, and the one real incident is buried under a script. One
 * row per address per category per window keeps the signal ("this address is probing us, since X")
 * while dropping the repetition, and the count carries how many were seen.
 */
const WINDOW_MS = 10 * 60 * 1000;
const seen = new Map();               // `${ip}:${kind}` -> { at, n }

// The map is bounded by distinct probing addresses in a 10-minute window, but a determined scanner
// can rotate addresses, so it is swept rather than trusted to stay small.
const sweep = () => {
    const cutoff = Date.now() - WINDOW_MS;
    for (const [k, v] of seen) if (v.at < cutoff) seen.delete(k);
};

const threatLog = (req, res, next) => {
    try {
        const hit = detectThreat(req);
        if (hit) {
            const ip = (req.headers['cloudfront-viewer-address'] || '').split(':')[0]
                || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
                || req.ip || 'unknown';
            const key = `${ip}:${hit.kind}`;
            const now = Date.now();
            const prev = seen.get(key);

            if (!prev || now - prev.at > WINDOW_MS) {
                if (seen.size > 500) sweep();
                seen.set(key, { at: now, n: 1 });
                recordSecurityEvent(req, {
                    action: ACTIONS.ATTACK_ATTEMPT,
                    severity: SEVERITY.URGENT,
                    detail: { kind: hit.kind, where: hit.where, sample: hit.sample },
                });
            } else {
                // Same address, same trick, same window: count it, do not write another row.
                prev.n += 1;
            }
        }
    } catch { /* detection must never break a request — this is telemetry, not a gate */ }
    next();
};

module.exports = { threatLog };
