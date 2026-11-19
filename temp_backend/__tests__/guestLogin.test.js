/**
 * The Play Store tester credential and the blast radius of the session it issues.
 *
 * Two independent things are proved here, because they fail independently:
 *
 *   1. ONLY the issued passphrase authenticates. Not a prefix of it, not a different username with the
 *      right passphrase, not an empty body, and not anything at all when the server has not opted in.
 *   2. A guest session, once issued, cannot write anything the campus can see — enforced by an
 *      ALLOWLIST, so a route added tomorrow is refused by default rather than accidentally exposed.
 *
 * Pure unit tests: no server, no database. They exercise the same functions the route calls, so they
 * run anywhere and cannot be skipped for want of a local Postgres.
 *
 *     node __tests__/guestLogin.test.js
 */

const assert = require('node:assert');

const {
    hashPassword,
    verifyPassword,
    getGuestConfig,
    verifyGuestCredential,
    normalizeSecret,
} = require('../utils/guestCredential');

const { GUEST_WRITE_ALLOWLIST, isGuestSession, GUEST_USER_ID } = require('../middlewares/guestGuard');

let pass = 0, fail = 0;
const check = (name, fn) => {
    try { fn(); pass++; console.log(`  ok    ${name}`); }
    catch (e) { fail++; console.log(`  FAIL  ${name}\n          ${e.message}`); }
};
const checkAsync = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ok    ${name}`); }
    catch (e) { fail++; console.log(`  FAIL  ${name}\n          ${e.message}`); }
};

// Mirrors guestGuard.guestReadOnly's decision without needing express in the loop.
const guestMayWrite = (path) => {
    const normalized = path.replace(/\/+$/, '') || '/';
    return GUEST_WRITE_ALLOWLIST.some((p) => p.test(normalized));
};

const PASSPHRASE = 'ABCDE-FGHJK-MNPQR-STVWX-YZ012';

(async () => {
    console.log('\nguest credential');

    const hash = await hashPassword(PASSPHRASE);

    await checkAsync('the exact passphrase verifies', async () => {
        assert.strictEqual(await verifyPassword(PASSPHRASE, hash), true);
    });

    // Testers retype this from a Play Console note on a phone. These three must all work or the
    // credential is unusable in practice, and support requests become "did you type the dashes?".
    await checkAsync('dashes are optional', async () => {
        assert.strictEqual(await verifyPassword('ABCDEFGHJKMNPQRSTVWXYZ012', hash), true);
    });
    await checkAsync('case is ignored', async () => {
        assert.strictEqual(await verifyPassword('abcde-fghjk-mnpqr-stvwx-yz012', hash), true);
    });
    await checkAsync('surrounding whitespace is ignored', async () => {
        assert.strictEqual(await verifyPassword('  ABCDE-FGHJK-MNPQR-STVWX-YZ012 \n', hash), true);
    });

    await checkAsync('one wrong character fails', async () => {
        assert.strictEqual(await verifyPassword('ABCDE-FGHJK-MNPQR-STVWX-YZ013', hash), false);
    });
    // Guards against a substring/prefix comparison creeping in — the bug that would turn a 125-bit
    // secret into a 25-step character-at-a-time guess.
    await checkAsync('a correct PREFIX fails', async () => {
        assert.strictEqual(await verifyPassword('ABCDE-FGHJK', hash), false);
    });
    await checkAsync('the empty passphrase fails', async () => {
        assert.strictEqual(await verifyPassword('', hash), false);
    });
    // A truthy-return bug here would accept everything, so it is worth its own line.
    await checkAsync('a malformed stored hash rejects rather than throwing', async () => {
        assert.strictEqual(await verifyPassword(PASSPHRASE, 'not-a-hash'), false);
        assert.strictEqual(await verifyPassword(PASSPHRASE, ''), false);
        assert.strictEqual(await verifyPassword(PASSPHRASE, undefined), false);
        assert.strictEqual(await verifyPassword(PASSPHRASE, 'scrypt.x.y.z.q.r'), false);
        // The pre-2026-08-31 '$'-delimited format. Not accepted — see the delimiter note in
        // utils/guestCredential.js.
        assert.strictEqual(await verifyPassword(PASSPHRASE, 'scrypt$16384$8$1$aaa$bbb'), false);
    });

    check('normalisation keeps the full 25 characters', () => {
        assert.strictEqual(normalizeSecret(PASSPHRASE).length, 25);
    });

    // THE REGRESSION THIS FILE EXISTS FOR, after the first production deploy failed on it.
    //
    // The hash is stored in temp_backend/.env, which docker-compose loads with `env_file` — and
    // Compose interpolates `$name` inside those values. The conventional `scrypt$N$r$p$salt$hash`
    // form meant Compose replaced `$ccBLvMM...` with an empty string on the way into the container.
    // The file on disk was correct, the deploy reported success, and the only symptom was the right
    // passphrase being rejected in production. Nothing else would have caught it.
    check('the stored hash contains no $ — docker-compose would eat it', () => {
        assert.ok(!hash.includes('$'), `hash must not contain '$': ${hash.slice(0, 20)}…`);
    });
    await checkAsync('...and that holds for freshly generated hashes too', async () => {
        for (let i = 0; i < 3; i++) {
            const fresh = await hashPassword('TEST-PASSPHRASE-VALUE');
            assert.ok(!fresh.includes('$'), 'a generated hash contained $');
            assert.ok(fresh.startsWith('scrypt.'), 'unexpected prefix: ' + fresh.slice(0, 10));
        }
    });

    console.log('\nserver configuration gate');

    const saved = { ...process.env };
    const setEnv = (o) => {
        delete process.env.GUEST_LOGIN_ENABLED;
        delete process.env.GUEST_LOGIN_USERNAME;
        delete process.env.GUEST_LOGIN_PASSWORD_HASH;
        Object.assign(process.env, o);
    };

    check('unconfigured -> guest login is off', () => {
        setEnv({});
        assert.strictEqual(getGuestConfig(), null);
    });
    // Each of these is a half-configured server. Every one must DISABLE the door, never open it.
    check('flag on but no username -> off', () => {
        setEnv({ GUEST_LOGIN_ENABLED: 'true', GUEST_LOGIN_PASSWORD_HASH: hash });
        assert.strictEqual(getGuestConfig(), null);
    });
    check('flag on but no hash -> off', () => {
        setEnv({ GUEST_LOGIN_ENABLED: 'true', GUEST_LOGIN_USERNAME: 'playstore-tester' });
        assert.strictEqual(getGuestConfig(), null);
    });
    check('a plaintext password in the hash variable -> off', () => {
        setEnv({ GUEST_LOGIN_ENABLED: 'true', GUEST_LOGIN_USERNAME: 'playstore-tester', GUEST_LOGIN_PASSWORD_HASH: 'hunter2' });
        assert.strictEqual(getGuestConfig(), null);
    });
    check('an old $-delimited hash -> off, rather than silently never matching', () => {
        setEnv({ GUEST_LOGIN_ENABLED: 'true', GUEST_LOGIN_USERNAME: 'playstore-tester', GUEST_LOGIN_PASSWORD_HASH: 'scrypt$16384$8$1$aaa$bbb' });
        assert.strictEqual(getGuestConfig(), null);
    });
    check('credentials set but flag off -> off', () => {
        setEnv({ GUEST_LOGIN_USERNAME: 'playstore-tester', GUEST_LOGIN_PASSWORD_HASH: hash });
        assert.strictEqual(getGuestConfig(), null);
    });
    check('fully configured -> on', () => {
        setEnv({ GUEST_LOGIN_ENABLED: 'true', GUEST_LOGIN_USERNAME: 'playstore-tester', GUEST_LOGIN_PASSWORD_HASH: hash });
        assert.notStrictEqual(getGuestConfig(), null);
    });

    console.log('\nfull credential check');

    setEnv({ GUEST_LOGIN_ENABLED: 'true', GUEST_LOGIN_USERNAME: 'playstore-tester', GUEST_LOGIN_PASSWORD_HASH: hash });

    await checkAsync('right username + right passphrase -> accepted', async () => {
        assert.strictEqual(await verifyGuestCredential('playstore-tester', PASSPHRASE), true);
    });
    await checkAsync('right username + wrong passphrase -> refused', async () => {
        assert.strictEqual(await verifyGuestCredential('playstore-tester', 'nope'), false);
    });
    await checkAsync('wrong username + right passphrase -> refused', async () => {
        assert.strictEqual(await verifyGuestCredential('admin', PASSPHRASE), false);
    });
    await checkAsync('missing fields -> refused', async () => {
        assert.strictEqual(await verifyGuestCredential(undefined, undefined), false);
        assert.strictEqual(await verifyGuestCredential('', ''), false);
        assert.strictEqual(await verifyGuestCredential(null, null), false);
    });
    await checkAsync('the door stays shut when the server has not opted in', async () => {
        setEnv({});
        assert.strictEqual(await verifyGuestCredential('playstore-tester', PASSPHRASE), false);
    });

    Object.assign(process.env, saved);

    console.log('\nguest session identification');

    check('the guest claim is recognised', () => {
        assert.strictEqual(isGuestSession({ guest: true, user_id: GUEST_USER_ID }), true);
    });
    check('the fixed user id alone is enough', () => {
        assert.strictEqual(isGuestSession({ user_id: GUEST_USER_ID }), true);
    });
    check('a real student is not a guest', () => {
        assert.strictEqual(isGuestSession({ user_id: 12345 }), false);
    });
    check('no session is not a guest', () => {
        assert.strictEqual(isGuestSession(null), false);
        assert.strictEqual(isGuestSession(undefined), false);
    });

    console.log('\nguest write allowlist');

    // Personal rows, scoped to the caller. A tester must be able to exercise these or half the app is
    // untestable.
    for (const p of ['/todos', '/todos/12', '/reminders/9', '/notice-reminders/3',
                     '/notifications/read', '/notifications/subscribe', '/user/preferences',
                     '/oauth/logout']) {
        check(`allowed:  ${p}`, () => assert.strictEqual(guestMayWrite(p), true));
    }

    // Everything the campus can see. Each of these was reachable before the guard existed, gated only
    // by the guest happening to hold no permission rows.
    for (const p of ['/events/create', '/events/update/3', '/events/delete/3', '/clubs/create',
                     '/clubs/update/1', '/admins/1', '/admin-permissions/grant', '/club-admins/add',
                     '/locations/create', '/event-categories/create', '/academic-calendar/publish',
                     '/ingestion/review', '/upload', '/analytics/overview', '/notices/publish']) {
        check(`refused:  ${p}`, () => assert.strictEqual(guestMayWrite(p), false));
    }

    // A trailing slash arrives or not depending on which proxy served the request. If the allowlist
    // were slash-sensitive, guest access would differ between CloudFront and the dev proxy.
    check('a trailing slash does not change the verdict', () => {
        assert.strictEqual(guestMayWrite('/todos/'), true);
        assert.strictEqual(guestMayWrite('/events/create/'), false);
    });
    // /user/preferences is allowed; nothing else under /user may be, or a future /user/promote would
    // inherit write access for free.
    check('the /user allowance is exactly /user/preferences', () => {
        assert.strictEqual(guestMayWrite('/user/preferences'), true);
        assert.strictEqual(guestMayWrite('/user/promote'), false);
        assert.strictEqual(guestMayWrite('/user'), false);
    });
    // Prefix matching must not let a similarly-named route through.
    check('a lookalike prefix is not allowed through', () => {
        assert.strictEqual(guestMayWrite('/todos-admin/wipe'), false);
        assert.strictEqual(guestMayWrite('/reminders-bulk/send'), false);
    });

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
})();
