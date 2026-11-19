/**
 * Auth rate limiter — a cheap CSRF-state rejection must not consume the bucket.
 * (run: node __tests__/authLimiter.test.js)
 *
 * Regression for a real, unauthenticated DoS. /oauth/token clears the oauth_state cookie the moment
 * the callback arrives, so ANY second request to that URL 403s — a reload, a back-button, a prefetch.
 * With those 403s counting, five plain `curl`s exhausted the 5-per-5-minutes bucket; and because the
 * whole campus sits behind one NAT address, that blocked login for every student behind it, for five
 * minutes, repeatably, with no credentials. Verified against production before the fix:
 *
 *     req 1-5 -> 403 Invalid OAuth state
 *     req 6   -> 429 Too many login attempts
 *
 * The limiter config below is copied from app.js. Genuine failures (a token exchange that 5xxs, i.e.
 * one that actually reached channeli.in) must STILL count — that half is what keeps the protection.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');

const MAX = 5;
let pass = 0; let fail = 0;
const check = (name, got, want) => {
    if (got === want) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
};

const makeLimiter = () => rateLimit({
    windowMs: 5 * 60 * 1000,
    max: MAX,
    message: 'Too many login attempts, please try again later.',
    skipSuccessfulRequests: true,
    requestWasSuccessful: (req, res) => res.statusCode < 400 || res.locals.oauthCheapReject === true,
    standardHeaders: true,
    legacyHeaders: false,
});

// Each route gets its OWN limiter instance so the three scenarios don't share a bucket.
const app = express();
app.use('/cheap', makeLimiter(), (req, res) => {
    res.locals.oauthCheapReject = true;                 // what routes/auth.js sets on a state mismatch
    res.status(403).json({ error: 'Invalid OAuth state' });
});
app.use('/real-failure', makeLimiter(), (req, res) => {
    res.status(500).json({ error: 'token exchange failed' });   // reached channeli.in and broke
});
app.use('/success', makeLimiter(), (req, res) => res.redirect('/app/home'));

const server = app.listen(0);
const port = server.address().port;
const hit = async (path) => (await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual' })).status;
const hitMany = async (path, n) => { const out = []; for (let i = 0; i < n; i++) out.push(await hit(path)); return out; };

(async () => {
    // 1. The DoS vector: many state-mismatch rejections must never produce a 429.
    const cheap = await hitMany('/cheap', 12);
    check('12 state-mismatch 403s never trip the limiter', cheap.every((s) => s === 403), true);
    check('  ...and none of them is a 429', cheap.includes(429), false);

    // 2. The protection that must survive: a failure that actually reached Channel-i still counts.
    const real = await hitMany('/real-failure', MAX + 2);
    check(`first ${MAX} genuine failures pass through`, real.slice(0, MAX).every((s) => s === 500), true);
    check('genuine failure number 6 is limited', real[MAX], 429);

    // 3. Successful logins never consume quota (pre-existing behaviour, must not regress).
    const ok = await hitMany('/success', MAX + 5);
    check('successful logins never trip the limiter', ok.every((s) => s === 302), true);

    server.close();
    console.log(`\n${pass}/${pass + fail} passed.`);
    process.exit(fail ? 1 : 0);
})();
