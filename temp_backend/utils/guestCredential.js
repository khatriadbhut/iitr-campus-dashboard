/**
 * The Play Store tester credential.
 *
 * Google's reviewers cannot sign in with Channel-i — it is IITR-only — so the Android build ships a
 * "Continue as guest" door. That door is on the public internet, so it is built to the same standard
 * as a password store rather than as a demo shortcut:
 *
 *   - The passphrase is 160 bits from a CSPRNG (see scripts/generate-guest-credential.js). Guessing is
 *     not a threat model at that size; the rate limits below it are defence in depth, not the defence.
 *   - Only a scrypt hash is ever stored. The plaintext exists in exactly two places: the reviewer's
 *     Play Console note, and wherever you keep it. Nothing in this repo or in the database holds it.
 *   - Every comparison is constant-time, including the USERNAME. Comparing usernames with === leaks
 *     which prefix is right one character at a time, which turns an unguessable secret into a
 *     guessable one for anyone patient with a stopwatch.
 *
 * Stored format (a single opaque env var, so rotating is one variable, not four):
 *
 *   scrypt.<N>.<r>.<p>.<salt base64>.<hash base64>
 *
 * The cost parameters travel WITH the hash rather than living in code, so raising them later does not
 * invalidate credentials already issued.
 *
 * The delimiter is '.', NOT the '$' that scrypt/argon2 conventionally use, and that is deliberate.
 * This value lives in temp_backend/.env, which docker-compose loads via `env_file` — and Compose
 * INTERPOLATES `$name` inside those values. A hash of the form `scrypt$16384$8$1$ccBLvMM...` had
 * `$ccBLvMM...` silently replaced with an empty string on the way into the container, so the
 * credential was corrupt in production while being perfectly valid on disk. Compose says so in its
 * log ("The ccBLvMM variable is not set") but the deploy still succeeds and the only symptom is that
 * the right passphrase is rejected. '.' is not special to Compose, and base64's alphabet
 * (A-Za-z0-9+/=) never contains one, so it cannot collide with the payload either.
 */

const crypto = require('crypto');

/**
 * Canonical form of a passphrase or username, applied identically when minting and when checking.
 *
 * Testers type this on a phone keyboard from a Play Console note, so "did you include the dashes?" and
 * a trailing space pasted from an email must not read as a wrong password. Case and separators are
 * folded away. This costs no entropy: the generator draws from an uppercase, separator-free alphabet
 * (Crockford base32 — no I, L, O or U, so nothing looks like a digit), which means the canonical form
 * has exactly as many possibilities as the printed one.
 */
const normalizeSecret = (value) => String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** Usernames are folded to lowercase and trimmed; they are an identifier, not a secret. */
const normalizeUsername = (value) => String(value ?? '').trim().toLowerCase();

// ~100ms on the deploy target. Deliberately slow: it caps an attacker at ~10 guesses/second/core even
// if every rate limiter in front of it were removed.
const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

// scrypt needs its working memory raised past node's 32MB default: 128 * N * r = 16MB for the
// parameters above, and node refuses the call rather than allocating silently.
const MAX_MEM = 256 * 1024 * 1024;

const scrypt = (password, salt, keylen, options) => new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derived) => {
        if (err) reject(err);
        else resolve(derived);
    });
});

/** Length-independent equality. Hashing first makes both operands 32 bytes, so timingSafeEqual — which
 *  THROWS on a length mismatch, and would thereby leak length — can be used on anything. */
const constantTimeEquals = (a, b) => {
    const ha = crypto.createHash('sha256').update(String(a), 'utf8').digest();
    const hb = crypto.createHash('sha256').update(String(b), 'utf8').digest();
    return crypto.timingSafeEqual(ha, hb);
};

/** Mint `scrypt$...` for a plaintext passphrase. Used by the generator script, never at request time. */
async function hashPassword(plaintext, params = DEFAULT_PARAMS) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const derived = await scrypt(normalizeSecret(plaintext), salt, KEY_LENGTH, { ...params, maxmem: MAX_MEM });
    return [
        'scrypt',
        params.N,
        params.r,
        params.p,
        salt.toString('base64'),
        derived.toString('base64'),
    ].join('.');
}

/**
 * Check a plaintext against a stored `scrypt$...` string.
 *
 * Returns false — never throws — on a malformed stored hash. A typo'd env var must read as "wrong
 * password", not as a 500 that tells the caller the credential store is broken.
 */
async function verifyPassword(plaintext, stored) {
    try {
        const parts = String(stored || '').split('.');
        if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

        const [, N, r, p, saltB64, hashB64] = parts;
        const params = { N: Number(N), r: Number(r), p: Number(p) };
        if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) return false;

        const salt = Buffer.from(saltB64, 'base64');
        const expected = Buffer.from(hashB64, 'base64');
        if (salt.length === 0 || expected.length === 0) return false;

        const derived = await scrypt(normalizeSecret(plaintext), salt, expected.length, { ...params, maxmem: MAX_MEM });
        return crypto.timingSafeEqual(derived, expected);
    } catch {
        return false;
    }
}

/**
 * The configured credential, or null if guest login is not switched on.
 *
 * Read on every call rather than cached at module load: the process reads its config from SSM at boot,
 * and a cached null would mean "turn the flag on" required a code deploy rather than a restart.
 *
 * All three variables are required. A half-configured guest login — flag on, hash missing — must
 * DISABLE the route, not open it.
 */
function getGuestConfig() {
    if (process.env.GUEST_LOGIN_ENABLED !== 'true') return null;

    const username = process.env.GUEST_LOGIN_USERNAME;
    const passwordHash = process.env.GUEST_LOGIN_PASSWORD_HASH;
    if (!username || !passwordHash) return null;
    if (!String(passwordHash).startsWith('scrypt.')) return null;

    return { username: String(username), passwordHash: String(passwordHash) };
}

/**
 * Verify a submitted username+password pair.
 *
 * Runs the scrypt derivation even when the USERNAME is already wrong. Short-circuiting there would
 * answer wrong-user in ~0ms and wrong-password in ~100ms, which hands out a free username oracle: an
 * attacker learns the account name for nothing and then only has the passphrase left to attack.
 */
async function verifyGuestCredential(username, password) {
    const config = getGuestConfig();
    if (!config) return false;

    const userMatches = constantTimeEquals(normalizeUsername(username), normalizeUsername(config.username));
    const passwordMatches = await verifyPassword(String(password ?? ''), config.passwordHash);

    return userMatches && passwordMatches;
}

module.exports = {
    hashPassword,
    normalizeSecret,
    normalizeUsername,
    verifyPassword,
    getGuestConfig,
    verifyGuestCredential,
    constantTimeEquals,
    DEFAULT_PARAMS,
};
