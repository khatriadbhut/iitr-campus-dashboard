/**
 * Unit test for the Gmail message normalizer (MIME decode + HTML→text + de-thread).
 * Uses mock Gmail API 'full' message payloads — no live credentials needed.
 * Run: node services/eventIngestion/source/__tests__/gmail.test.js
 */
const assert = require('assert');
const { normalizeMessage } = require('../gmail');
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');

let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('✅', name); } catch (e) { fail++; console.log('❌', name, '\n   ', e.message); } };

// 1. HTML multipart email → clean text, tags stripped, quoted history removed
check('HTML multipart decodes to clean text', () => {
    const html = '<html><body><p>All are welcome to attend the Guest Lecture on <b>July 18, 2026</b> at APJ 103.</p>'
        + '<p>Register at <a href="https://forms.gle/abc">https://forms.gle/abc</a>.</p>'
        + '<div>On Mon, Jul 1, 2026 at 9:00 AM Someone &lt;x@y.com&gt; wrote:</div><blockquote>old quoted stuff</blockquote>'
        + '</body></html>';
    const msg = {
        id: 'g1', threadId: 't1', internalDate: '1690000000000',
        payload: {
            mimeType: 'multipart/alternative',
            headers: [
                { name: 'From', value: 'Head Management Studies <head@ms.iitr.ac.in>' },
                { name: 'To', value: 'students-notices@iitr.ac.in' },
                { name: 'Subject', value: 'Special Lecture at APJ 103' },
                { name: 'Message-ID', value: '<abc123@mail.iitr.ac.in>' },
            ],
            parts: [
                { mimeType: 'text/plain', body: {} },
                { mimeType: 'text/html', body: { data: b64url(html) } },
            ],
        },
    };
    const n = normalizeMessage(msg);
    assert.strictEqual(n.message_id, '<abc123@mail.iitr.ac.in>', 'message_id from header');
    assert.strictEqual(n.gmail_id, 'g1');
    assert.strictEqual(n.subject, 'Special Lecture at APJ 103');
    assert.ok(n.from.includes('head@ms.iitr.ac.in'));
    assert.ok(!/[<>]/.test(n.body_text.replace(/https?:\/\/\S+/g, '')), 'no leftover HTML tags');
    assert.ok(n.body_text.includes('welcome to attend the Guest Lecture'), 'body content present');
    assert.ok(n.body_text.includes('July 18, 2026') && n.body_text.includes('APJ 103'), 'facts present');
    assert.ok(!n.body_text.includes('old quoted stuff'), 'quoted history stripped');
    assert.ok(n.internal_date instanceof Date, 'internalDate parsed');
});

// 2. Plain-text email preferred over html when present
check('plain text part is preferred', () => {
    const msg = {
        id: 'g2', threadId: 't2', internalDate: '1690000000000',
        payload: {
            mimeType: 'multipart/alternative',
            headers: [{ name: 'From', value: 'awards <awards@iitr.ac.in>' }, { name: 'Subject', value: 'Scholarship' }],
            parts: [
                { mimeType: 'text/plain', body: { data: b64url('Apply for the scholarship by 20 August 2026.') } },
                { mimeType: 'text/html', body: { data: b64url('<p>SHOULD NOT BE USED</p>') } },
            ],
        },
    };
    const n = normalizeMessage(msg);
    assert.ok(n.body_text.includes('Apply for the scholarship'), 'plain text used');
    assert.ok(!n.body_text.includes('SHOULD NOT BE USED'), 'html ignored when plain present');
});

// 3. Nested multipart (multipart/mixed → multipart/alternative → parts) still found
check('nested multipart bodies collected', () => {
    const msg = {
        id: 'g3', threadId: 't3', internalDate: '1690000000000',
        payload: {
            mimeType: 'multipart/mixed',
            headers: [{ name: 'From', value: 'x@iitr.ac.in' }, { name: 'Subject', value: 'Nested' }],
            parts: [
                { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64url('Deep body text here.') } }] },
                { mimeType: 'application/pdf', filename: 'poster.pdf', body: { attachmentId: 'a1' } },
            ],
        },
    };
    const n = normalizeMessage(msg);
    assert.ok(n.body_text.includes('Deep body text here'), 'nested body found');
});


// ── the plain part loses hyperlinks; the html part keeps them ────────────────────────────────────
// A real notice read "uploaded on the ELECTION COMMISSION PORTAL" and was published with no link at
// all: the sender's text/plain alternative flattens <a href> down to the label and drops the address.
// Plain stays the default (cleaner, and every downstream extractor is tuned to it) — but not when it
// is the version that lost the URL.
check('a link only present in the HTML part is not lost', () => {
    const mk = (plain, html) => normalizeMessage({
        id: 'g9', threadId: 't9', internalDate: '1690000000000',
        payload: {
            mimeType: 'multipart/alternative',
            headers: [
                { name: 'From', value: 'Associate DOSW <adoswsa@iitr.ac.in>' },
                { name: 'To', value: 'students-notices@iitr.ac.in' },
                { name: 'Subject', value: 'Bhawan and SAC Elections - Voter List' },
                { name: 'Message-ID', value: '<sac@mail.iitr.ac.in>' },
            ],
            parts: [
                { mimeType: 'text/plain', body: plain ? { data: b64url(plain) } : {} },
                { mimeType: 'text/html', body: html ? { data: b64url(html) } : {} },
            ],
        },
    });

    // THE CASE: plain has the words, html has the address.
    const lost = mk('The voter list is uploaded on the ELECTION COMMISSION PORTAL.',
        '<p>The voter list is uploaded on the <a href="https://election.iitr.ac.in">ELECTION COMMISSION PORTAL</a>.</p>');
    assert.ok(/election\.iitr\.ac\.in/.test(lost.body_text), 'recovers the href from the HTML part');

    // Plain that DOES carry the url (Zimbra style) is kept as-is — it is the tidier text.
    const zimbra = mk('Register [ https://forms.gle/abc | here ]',
        '<p>Register <a href="https://forms.gle/abc">here</a></p>');
    assert.ok(/\[ https:\/\/forms\.gle\/abc \| here \]/.test(zimbra.body_text), 'keeps the plain part when it already has the link');

    // No links anywhere → plain wins, unchanged.
    const none = mk('Please note the revised timings.', '<p>Please note the revised timings.</p>');
    assert.strictEqual(none.body_text.trim(), 'Please note the revised timings.');
});

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail ? 1 : 0);
