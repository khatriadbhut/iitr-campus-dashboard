/**
 * Attack detection, and the severity rule that decides what deserves a person's attention.
 *
 * The false-positive cases matter as much as the true ones: a detector that flags ordinary campus
 * copy trains everyone to ignore the security log, which is worse than not having one.
 */
const { detectThreat } = require('../utils/threatDetect');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log(`  ok  ${n}`)) : (fail++, console.log(`  FAIL ${n}`)); };
const req = (url, body) => ({ originalUrl: url, url, body });

// ── Should be caught ───────────────────────────────────────────────────────
const CAUGHT = [
    ['classic tautology',        req("/events?id=1' OR 1=1 --"),                       'sql_injection'],
    ['union select',             req('/events?q=1 UNION SELECT password FROM "user"'), 'sql_injection'],
    ['stacked drop',             req('/api?x=1; DROP TABLE privilege_audit'),          'sql_injection'],
    ['schema probe',             req('/x?q=information_schema.tables'),                'sql_injection'],
    ['time-based blind',         req('/x?q=1 AND pg_sleep(10)'),                       'sql_injection'],
    ['script tag in url',        req('/search?q=<script>alert(1)</script>'),           'xss_attempt'],
    ['event handler in url',     req('/x?n=<img onerror=alert(1)>'),                   'xss_attempt'],
    ['traversal to passwd',      req('/files?p=../../../../etc/passwd'),               'path_traversal'],
    ['encoded traversal',        req('/files?p=%2e%2e%2f%2e%2e%2f'),                   'path_traversal'],
    ['wordpress probe',          req('/wp-login.php'),                                 'scanner_probe'],
    ['env file probe',           req('/.env'),                                         'scanner_probe'],
    ['git config probe',         req('/.git/config'),                                  'scanner_probe'],
    ['command chain',            req('/x?c=;cat /etc/hosts'),                          'command_injection'],
    ['sql in body',              req('/proposals', { title: "x'; DROP TABLE event; --" }), 'sql_injection'],
];
for (const [name, r, kind] of CAUGHT) {
    const hit = detectThreat(r);
    check(`catches ${name}`, hit?.kind === kind);
}

// ── As Express actually delivers them: PERCENT-ENCODED ─────────────────────
// This is the case the original tests missed. They fed decoded strings and passed, while production
// silently logged nothing: req.originalUrl arrives encoded, so `' OR 1=1 --` reaches the detector as
// `%27%20OR%201%3D1%20--` and matched none of the patterns.
const ENCODED = [
    ['encoded SQL injection',   "/events?id=1%27%20OR%201%3D1%20--",              'sql_injection'],
    ['double-encoded SQLi',     "/events?id=1%2527%2520OR%25201%253D1",           'sql_injection'],
    ['encoded traversal',       '/f?p=%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',   'path_traversal'],
    ['encoded script tag',      '/s?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E',       'xss_attempt'],
    // A malformed escape must not buy an attacker the rest of the request: decodeURIComponent throws
    // on `%zz`, and an unguarded fallback would leave the whole string unexamined.
    ['payload behind %zz',      '/x?q=%zz%27%20OR%201%3D1',                       'sql_injection'],
    ['payload behind a lone %', '/x?q=100%25%20off%20OR%201%3D1',                 'sql_injection'],
    // `+` is the form encoding for a space and decodeURIComponent leaves it alone. This exact string
    // is what nginx logged from a live probe that produced no row at all.
    ['plus-encoded SQLi (as nginx logged it)', '/api/analytics/overview?id=1%27+OR+1%3d1+--', 'sql_injection'],
    ['plus-encoded UNION SELECT',              '/events?q=1+UNION+SELECT+password+FROM+users', 'sql_injection'],
];
for (const [name, url, kind] of ENCODED) {
    const hit = detectThreat(req(url));
    check(`catches ${name}`, hit?.kind === kind);
}

// ── Must NOT be caught ─────────────────────────────────────────────────────
const CLEAN = [
    ['an ordinary event page',      req('/app/event/482')],
    ['a search for a club',         req('/events?q=Fine%20Arts%20Section')],
    ['a title containing "select"', req('/proposals', { title: 'How to select a research topic' })],
    ['a title containing "union"',  req('/proposals', { title: 'Students Union Budget Talk' })],
    ['a notice about dropping',     req('/notices', { title: 'Course drop deadline extended' })],
    ['a date range query',          req('/analytics/logs?from=2026-08-01T00:00:00.000Z&limit=50')],
    ['an apostrophe in a name',     req('/proposals', { title: "Founder's Day Celebration" })],
    ['markup in an admin body',     req('/notices', { body: 'Use <script> tags carefully, said the speaker' })],
    ['an encoded apostrophe',       req('/events?q=Founder%27s%20Day%20Celebration')],
    ['a percent sign in copy',      req('/notices?q=50%25%20seats%20filled')],
    ['plus signs in a real search', req('/events?q=Rock+Band+Auditions')],
];
for (const [name, r] of CLEAN) {
    const hit = detectThreat(r);
    check(`ignores ${name}`, hit === null || (fail++, console.log(`       (flagged as ${hit.kind}: "${hit.sample}")`), false));
}

// A body is capped, so a huge payload cannot turn detection into the slow path.
const huge = detectThreat(req('/x', { blob: 'a'.repeat(200000) }));
check('a very large body does not hang detection', huge === null);

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail ? 1 : 0);
