/**
 * Recognises requests that are trying something, so they land in the security log with a name.
 *
 * SCOPE, stated plainly: this DETECTS and RECORDS. It never blocks. The app's actual defences are
 * elsewhere and are structural — Sequelize binds every parameter, so a quote in a query string is a
 * quote and not SQL; React escapes what it renders; routes take ids, not paths. This file does not
 * add protection, it adds VISIBILITY: it turns "someone probed us at 3am" from something nobody ever
 * learns into a row with a time, an address and a category.
 *
 * Blocking on these patterns would be worse than useless. Every regex here has false positives — a
 * notice legitimately titled "Drop table service resumes" is not an attack — and a filter that
 * rejects real submissions to stop an attack the ORM already defeats trades a genuine failure for an
 * imaginary one. So: log, classify, never reject.
 *
 * WHERE EACH PATTERN IS APPLIED matters as much as the pattern itself:
 *   · URL and query string are scanned for everything. Nothing legitimate in this app puts markup or
 *     SQL keywords in a URL.
 *   · Bodies are scanned only for SQL, traversal and command injection. Markup patterns are NOT
 *     applied to bodies, because an admin pasting an event description containing "<script" into the
 *     review form is a plausible Tuesday, and flagging it would train everyone to ignore the log.
 */

const PATTERNS = [
    {
        kind: 'sql_injection',
        // Deliberately narrow: keyword pairs and classic tautologies, not the bare words. "select" and
        // "union" appear in ordinary prose ("union budget", "select few") and matching those alone
        // would make the category meaningless.
        re: /(\bunion\b[\s\S]{0,40}\bselect\b)|(\bselect\b[\s\S]{0,40}\bfrom\b[\s\S]{0,40}\bwhere\b)|(\bor\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+)|(;\s*(drop|truncate|delete)\s+(table|from))|(\b(pg_sleep|benchmark)\s*\()|(information_schema\.)|(\bxp_cmdshell\b)/i,
        body: true,
    },
    {
        kind: 'xss_attempt',
        re: /(<\s*script\b)|(\bon(error|load|click|mouseover)\s*=\s*['"]?\s*[a-z_$])|(javascript\s*:)|(<\s*iframe\b)|(document\.cookie)/i,
        body: false,          // see the note above — admin-authored copy legitimately contains markup
    },
    {
        kind: 'path_traversal',
        re: /(\.\.[/\\]){2,}|(%2e%2e[/\\%])|(\/etc\/(passwd|shadow))|(\bfile:\/\/)/i,
        body: true,
    },
    {
        kind: 'command_injection',
        re: /([;|`]\s*(cat|ls|rm|curl|wget|nc|bash|sh|whoami|id)\s)|(\$\((.{0,30})\))|(\|\s*(curl|wget|bash|sh)\b)/i,
        body: true,
    },
    {
        kind: 'scanner_probe',
        // Requests for software this app does not run. Nobody arrives at /wp-login.php by accident;
        // it is an automated sweep looking for a different stack, and it is the single most common
        // thing any public host sees.
        re: /\/(wp-login|wp-admin|xmlrpc\.php|phpmyadmin|\.env|\.git\/config|\.aws\/credentials|config\.json|actuator\/env|\.ssh\/id_rsa)/i,
        body: false,
    },
];

/** Bodies can be large; a probe never needs to be. Cap the work per request. */
const MAX_BODY_CHARS = 4096;
const MAX_SAMPLE = 160;

/**
 * Express hands over `originalUrl` PERCENT-ENCODED, so a query string carrying `' OR 1=1 --` arrives
 * as `%27%20OR%201%3D1%20--` and matches nothing. Every pattern here is written against readable
 * text, so the URL has to be decoded before it is tested — this was live and silent: the unit tests
 * fed decoded strings and passed, while production logged no injection attempts at all.
 *
 * Decoded TWICE, because `%2527` decodes to `%27` and only then to a quote — double-encoding is the
 * standard way past a single-pass filter. Both intermediate forms are kept and scanned, since a
 * pattern may match the raw text and not the decoded one (an encoded path traversal, say).
 *
 * decodeURIComponent THROWS on a malformed sequence such as `%zz`, which is itself an evasion: throw
 * inside detection and the request goes unexamined. Each step falls back to the input it was given.
 */
const decodeSafe = (v) => {
    // A stray `%` (as in `%zz`) makes decodeURIComponent throw, which would drop the WHOLE string back
    // to its encoded form and let the rest of the payload through unexamined — one junk character
    // buying an attacker the entire request. Escaping lone percent signs first makes the decode total,
    // so `%zz%27%20OR%201%3D1` still yields `%zz' OR 1=1` and still matches.
    try { return decodeURIComponent(v.replace(/%(?![0-9a-fA-F]{2})/g, '%25')); } catch { return v; }
};
const forms = (v) => {
    // `+` MEANS SPACE in a query string (application/x-www-form-urlencoded) and decodeURIComponent
    // does not translate it, so `1%27+OR+1%3d1` decodes to `1'+OR+1=1` and a pattern expecting
    // whitespace after OR misses it. Found by firing a real probe at production and getting no row:
    // nginx logged `?id=1%27+OR+1%3d1+--` while the detector saw nothing.
    //
    // Scanned as an EXTRA form rather than a replacement, because `+` is a literal character in a
    // path and in body JSON — substituting it everywhere would corrupt those.
    const plus = v.includes('+') ? v.replace(/\+/g, ' ') : null;
    const out = [v, plus].filter(Boolean).flatMap((x) => {
        const once = decodeSafe(x);
        return [x, once, decodeSafe(once)];
    });
    return [...new Set(out)];
};

const stringify = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v).slice(0, MAX_BODY_CHARS); } catch { return ''; }
};

/**
 * @returns {{kind: string, sample: string, where: string} | null}
 * The first category matched, with a short redacted excerpt so the log says what was seen without
 * storing the whole payload — an audit table that accumulates request bodies becomes the thing worth
 * stealing.
 */
function detectThreat(req) {
    const urlForms = forms(String(req.originalUrl || req.url || ''));
    const bodyForms = forms(stringify(req.body).slice(0, MAX_BODY_CHARS)).filter(Boolean);

    for (const p of PATTERNS) {
        for (const u of urlForms) {
            const hit = p.re.exec(u);
            if (hit) return { kind: p.kind, sample: hit[0].slice(0, MAX_SAMPLE), where: 'url' };
        }
        if (!p.body) continue;
        for (const b of bodyForms) {
            const hit = p.re.exec(b);
            if (hit) return { kind: p.kind, sample: hit[0].slice(0, MAX_SAMPLE), where: 'body' };
        }
    }
    return null;
}

module.exports = { detectThreat, PATTERNS };
