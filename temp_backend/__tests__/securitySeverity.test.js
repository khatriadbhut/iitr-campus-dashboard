/**
 * Severity: what earns a person's attention.
 *
 * The rule the whole thing rests on — one failed login is a typo, many from one address is someone
 * working through a list — is only correct at a boundary, so the boundary is what is tested.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')) {
    console.error('REFUSING TO RUN: DATABASE_URL is not local'); process.exit(1);
}
const { PrivilegeAudit, sequelize } = require('../database/schemas');
const { recordSecurityEvent, ACTIONS, SEVERITY, BURST_COUNT } = require('../utils/activityLog');

const IP = '198.51.100.42';                       // TEST-NET-2
const IP2 = '198.51.100.43';
let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log(`  ok  ${n}`)) : (fail++, console.log(`  FAIL ${n}`)); };
const fakeReq = (ip) => ({ headers: { 'x-forwarded-for': ip }, ip, path: '/auth/oauth/token', method: 'POST' });

(async () => {
  try {
    await PrivilegeAudit.destroy({ where: { ip: [IP, IP2] } });

    // ── A lone failure is routine ──────────────────────────────────────────
    await recordSecurityEvent(fakeReq(IP), { action: ACTIONS.LOGIN_FAILED, detail: { reason: 'bad_state' } });
    let rows = await PrivilegeAudit.findAll({ where: { ip: IP }, order: [['id', 'ASC']] });
    check('one failed login is routine, not urgent', rows[0].severity === SEVERITY.ROUTINE);

    // ── Escalation at the boundary ─────────────────────────────────────────
    for (let i = 1; i < BURST_COUNT; i++) {
        await recordSecurityEvent(fakeReq(IP), { action: ACTIONS.LOGIN_FAILED, detail: { reason: 'bad_state' } });
    }
    rows = await PrivilegeAudit.findAll({ where: { ip: IP }, order: [['id', 'ASC']] });
    check(`the first ${BURST_COUNT - 1} stay routine`,
        rows.slice(0, BURST_COUNT - 1).every((r) => r.severity === SEVERITY.ROUTINE));
    check(`failure #${BURST_COUNT} from one address becomes urgent`,
        rows[BURST_COUNT - 1].severity === SEVERITY.URGENT);

    // ── The burst belongs to the ADDRESS, not the app ──────────────────────
    await recordSecurityEvent(fakeReq(IP2), { action: ACTIONS.LOGIN_FAILED, detail: { reason: 'bad_state' } });
    const other = await PrivilegeAudit.findAll({ where: { ip: IP2 } });
    check('a different address starts over at routine', other[0].severity === SEVERITY.ROUTINE);

    // ── Things that are urgent on their own ────────────────────────────────
    await recordSecurityEvent(fakeReq(IP2), { action: ACTIONS.RATE_LIMITED, detail: { limiter: 'auth' } });
    await recordSecurityEvent(fakeReq(IP2), { action: ACTIONS.ATTACK_ATTEMPT, severity: SEVERITY.URGENT, detail: { kind: 'sql_injection' } });
    const urgent = await PrivilegeAudit.findAll({ where: { ip: IP2, severity: SEVERITY.URGENT } });
    check('a tripped limiter is urgent immediately', urgent.some((r) => r.action === ACTIONS.RATE_LIMITED));
    check('an attack attempt is urgent immediately', urgent.some((r) => r.action === ACTIONS.ATTACK_ATTEMPT));

    // ── The middleware, through a real HTTP request ────────────────────────
    const probe = "/events?id=1' OR 1=1 --";
    await fetch(`http://localhost:8081${probe}`).catch(() => {});
    await fetch('http://localhost:8081/wp-login.php').catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
    const logged = await PrivilegeAudit.findAll({
        where: { action: ACTIONS.ATTACK_ATTEMPT },
        order: [['id', 'DESC']], limit: 10,
    });
    check('a real SQL-injection request is logged by the live server',
        logged.some((r) => r.detail?.kind === 'sql_injection'));
    check('a real scanner probe is logged by the live server',
        logged.some((r) => r.detail?.kind === 'scanner_probe'));
    check('logged attacks are urgent', logged.every((r) => r.severity === SEVERITY.URGENT));
    check('the payload is sampled, not stored whole',
        logged.every((r) => (r.detail?.sample || '').length <= 160));

    // The app must not have been broken by any of it — detection never blocks.
    const still = await fetch('http://localhost:8081/').then((r) => r.status);
    check('the server still serves normal requests', still === 200);
  } finally {
    await PrivilegeAudit.destroy({ where: { ip: [IP, IP2] } });
    await sequelize.close();
  }
  console.log(`\n${pass}/${pass + fail} passed.`);
  process.exit(fail ? 1 : 0);
})();
