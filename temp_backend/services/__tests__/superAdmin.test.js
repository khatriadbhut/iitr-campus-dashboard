/**
 * Authorization test for the grant routes: everything that hands out access is super-admin only.
 *
 * This is a LIVE test — it talks to a running server on :8081 with DEV_LOGIN=true, because the thing
 * under test is the middleware chain, and a unit test that stubs the middleware would prove nothing.
 * It skips cleanly when the server is not up, so it never fails a machine that just isn't running it.
 *
 *   cd temp_backend && npm start          # in one shell
 *   node services/__tests__/superAdmin.test.js
 *
 * The dev-login user must NOT be a super admin for the refusals to mean anything — the test asserts
 * that first and stops if it is, rather than reporting seven hollow passes.
 */
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:8081';
// Writes are also behind an Origin/Referer check, so a request without this header is refused before
// it ever reaches the permission gate — which would look like a pass for the wrong reason.
const ORIGIN = process.env.TEST_ORIGIN || 'http://localhost:5173';

let cookie = '';

const login = async () => {
    const r = await fetch(`${BASE}/oauth/dev-login`, { redirect: 'manual' });
    cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    return !!cookie;
};

const call = async (method, path, body) => {
    const r = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie },
        body: body ? JSON.stringify(body) : undefined,
    });
    let j = null;
    try { j = await r.json(); } catch { /* empty body is fine */ }
    return { status: r.status, msg: j?.message || j?.error || '' };
};

let pass = 0, fail = 0;
const check = (label, got, want) => {
    const ok = got.status === want;
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${label.padEnd(52)} ${got.status}${ok ? '' : ` (want ${want})`}  ${got.msg.slice(0, 46)}`);
};

(async () => {
    try {
        await fetch(`${BASE}/health`);
    } catch {
        console.log(`SKIP superAdmin.test.js — no server on ${BASE}`);
        process.exit(0);
    }

    if (!(await login())) {
        console.log('SKIP superAdmin.test.js — dev-login unavailable (needs DEV_LOGIN=true)');
        process.exit(0);
    }

    const me = await fetch(`${BASE}/oauth/user`, { headers: { Cookie: cookie } }).then((r) => r.json()).catch(() => null);
    if (me?.authContext?.is_super_admin === true) {
        console.log('SKIP superAdmin.test.js — the dev user IS a super admin, so refusals prove nothing.');
        console.log('     UPDATE "user" SET is_super_admin=false WHERE user_id=999000001;  then re-run');
        process.exit(0);
    }

    console.log('── every grant path refuses a non-super-admin ──');
    check('POST   /admins/add', await call('POST', '/admins/add', { enrolment_number: '00000000', permission_ids: [1] }), 403);
    check('PATCH  /admins/:id', await call('PATCH', '/admins/999000001', { permission_ids: [1] }), 403);
    check('PATCH  /admins/:id (forging is_super_admin)', await call('PATCH', '/admins/999000001', { permission_ids: [1], is_super_admin: true }), 403);
    check('DELETE /admins/:id', await call('DELETE', '/admins/999000001'), 403);
    check('POST   /club-admins/club/:id/add', await call('POST', '/club-admins/club/1/add', { enrolment_number: '00000000' }), 403);
    check('DELETE /club-admins/club/:id/:user', await call('DELETE', '/club-admins/club/1/999000001'), 403);
    check('PATCH  /admin-permissions/:id', await call('PATCH', '/admin-permissions/1', { name: 'renamed' }), 403);
    check('DELETE /admin-permissions/:id', await call('DELETE', '/admin-permissions/1'), 403);

    // Reads must keep working, or an ordinary admin cannot even open the panel.
    console.log('\n── reads stay available to an ordinary admin ──');
    check('GET    /admins/all', await call('GET', '/admins/all'), 200);

    console.log(`\n${pass}/${pass + fail} passed.`);
    process.exit(fail ? 1 : 0);
})();
