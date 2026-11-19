/**
 * Analytics must be readable by super admins ONLY — never by a club admin, not even one holding
 * manage_club_admins (which an earlier draft of the gate wrongly accepted).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')) {
    console.error('REFUSING TO RUN: DATABASE_URL is not local'); process.exit(1);
}
const jwt = require('jsonwebtoken');
const { User, AdminPermission, AdminPermissionAlloted, sequelize } = require('../database/schemas');

const BASE = 'http://localhost:8081';
const ID = 900777;                       // fixture only; removed in finally
let pass = 0, fail = 0;
const check = (name, cond) => { cond ? (pass++, console.log(`  ok  ${name}`)) : (fail++, console.log(`  FAIL ${name}`)); };

// Every super-admin-only route, listed once. A new analytics endpoint added without a line here is
// the failure mode this guards against, so keep it in step with routes/analytics.js.
const ENDPOINTS = ['/analytics/overview', '/analytics/logs', '/analytics/logs/counts', '/analytics/content'];

const tokenFor = (u) => jwt.sign({ user_id: u.user_id, id: u.user_id, tv: u.token_version || 0 }, process.env.JWT_SECRET, { expiresIn: '10m' });
const get = (path, token) => fetch(`${BASE}${path}`, { headers: { Cookie: `auth_token=${token}` } }).then(r => r.status);

(async () => {
  try {
    await User.destroy({ where: { user_id: ID } });
    const clubAdmin = await User.create({
        user_id: ID, full_name: 'Gate Test Club Admin', enrolment_number: 'GATE900777',
        email: 'gate900777@example.invalid', is_super_admin: false, token_version: 0,
    });

    // Give them the MOST powerful grantable permission — the one the broken gate accepted.
    const perm = await AdminPermission.findOne({ where: { name: 'manage_club_admins' } });
    check('manage_club_admins permission exists to test against', !!perm);
    if (perm) await AdminPermissionAlloted.create({ user_id: ID, admin_permission_id: perm.id });

    const t = tokenFor(clubAdmin);
    for (const p of ENDPOINTS) {
        check(`club admin w/ manage_club_admins is REFUSED ${p}`, (await get(p, t)) === 403);
    }

    // Now promote the same user and confirm the page actually works for a real super admin.
    await User.update({ is_super_admin: true }, { where: { user_id: ID } });
    const t2 = tokenFor(await User.findByPk(ID));
    for (const p of ENDPOINTS) {
        check(`super admin is ALLOWED ${p}`, (await get(p, t2)) === 200);
    }

    // Demotion must bite immediately, on the SAME token — the guard reads the DB, not the JWT.
    await User.update({ is_super_admin: false }, { where: { user_id: ID } });
    check('demotion refuses the very next call on an unexpired token', (await get('/analytics/overview', t2)) === 403);

    check('anonymous caller is refused', [401, 403].includes(await fetch(`${BASE}/analytics/overview`).then(r => r.status)));
  } finally {
    await AdminPermissionAlloted.destroy({ where: { user_id: ID } });
    await User.destroy({ where: { user_id: ID } });
    await sequelize.close();
  }
  console.log(`\n${pass}/${pass + fail} passed.`);
  process.exit(fail ? 1 : 0);
})();
