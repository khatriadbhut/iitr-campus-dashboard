/**
 * Gmail source adapter — uses Google's official `googleapis` client (auto OAuth2 token
 * refresh) + `html-to-text`. The backend authenticates with ITS OWN credentials (not
 * the assistant's MCP). Configure via env; until then isConfigured() is false and the
 * runner no-ops:
 *
 *   GMAIL_CLIENT_ID       OAuth client id
 *   GMAIL_CLIENT_SECRET   OAuth client secret
 *   GMAIL_REFRESH_TOKEN   refresh token for the ingestion mailbox (one-time consent)
 *   GMAIL_USER            mailbox address (default 'me' = the token owner)
 *   INGEST_QUERY          Gmail search for backfill (default: broadcast list)
 */
const { google } = require('googleapis');
const { convert } = require('html-to-text');

const CFG = () => ({
    clientId: process.env.GMAIL_CLIENT_ID,
    secret: process.env.GMAIL_CLIENT_SECRET,
    refresh: process.env.GMAIL_REFRESH_TOKEN,
    user: process.env.GMAIL_USER || 'me',
    query: process.env.INGEST_QUERY || 'to:students-notices@iitr.ac.in',
});

const isConfigured = () => { const c = CFG(); return !!(c.clientId && c.secret && c.refresh); };

// Build a Gmail client bound to an auto-refreshing OAuth2 credential.
function gmailClient() {
    const c = CFG();
    const auth = new google.auth.OAuth2(c.clientId, c.secret);
    auth.setCredentials({ refresh_token: c.refresh });   // library refreshes access tokens itself
    return google.gmail({ version: 'v1', auth });
}

// Retry transient failures (rate-limit / 5xx / network) with exponential backoff.
async function withRetry(fn, { tries = 4 } = {}) {
    for (let i = 0; ; i++) {
        try { return await fn(); }
        catch (e) {
            const status = e.code || e.response?.status;
            const transient = status === 429 || (status >= 500 && status < 600)
                || ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(e.code);
            if (!transient || i >= tries - 1) throw e;
            await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** i, 15000)));
        }
    }
}

/** message ids matching the backfill query (paginated, capped). */
async function listMessageIds({ query, max = 120 } = {}) {
    const gmail = gmailClient();
    const ids = [];
    let pageToken;
    do {
        const { data } = await withRetry(() => gmail.users.messages.list({
            userId: CFG().user, q: query || CFG().query, maxResults: 100, pageToken,
        }));
        (data.messages || []).forEach((m) => ids.push(m.id));
        pageToken = data.nextPageToken;
    } while (pageToken && ids.length < max);
    return ids.slice(0, max);
}

async function getMessage(id) {
    const gmail = gmailClient();
    const { data } = await withRetry(() => gmail.users.messages.get({ userId: CFG().user, id, format: 'full' }));
    return data;
}

async function getProfile() {
    const gmail = gmailClient();
    const { data } = await withRetry(() => gmail.users.getProfile({ userId: CFG().user }));
    return data;
}

/** new message ids since a historyId (incremental). Returns {ids, historyId, expired}. */
async function listHistory(startHistoryId) {
    const gmail = gmailClient();
    const ids = new Set();
    let pageToken, latest = startHistoryId;
    try {
        do {
            const { data } = await withRetry(() => gmail.users.history.list({
                userId: CFG().user, startHistoryId, historyTypes: ['messageAdded'], pageToken,
            }));
            (data.history || []).forEach((h) => (h.messagesAdded || []).forEach((m) => ids.add(m.message.id)));
            if (data.historyId) latest = data.historyId;
            pageToken = data.nextPageToken;
        } while (pageToken);
    } catch (e) {
        if ((e.code || e.response?.status) === 404) return { ids: [], historyId: null, expired: true };
        throw e;
    }
    return { ids: [...ids], historyId: latest, expired: false };
}

/** Health check — confirms credentials work; returns the mailbox address. */
async function verify() {
    const p = await getProfile();
    return { ok: true, email: p.emailAddress, messagesTotal: p.messagesTotal };
}

// An expired/revoked OAuth refresh token (the #1 silent-death cause — the consent screen expires it
// after ~7 days in "Testing" mode) surfaces as invalid_grant / 401 rather than a transient error.
function isAuthError(e) {
    const status = e && (e.code || e.response?.status);
    const blob = `${(e && e.message) || ''} ${JSON.stringify((e && e.response?.data) || '')}`;
    return status === 401
        || /invalid_grant|invalid_credentials|unauthorized|no refresh token is set|token has been expired or revoked|insufficient authentication/i.test(blob);
}

// ── MIME decode + normalize ─────────────────────────────────────────────────
const decodeB64 = (data) => Buffer.from(data || '', 'base64url').toString('utf8');

function collectBodies(payload, out = { plain: '', html: '' }) {
    if (!payload) return out;
    const mt = payload.mimeType || '';
    if (mt === 'text/plain' && payload.body?.data) out.plain += decodeB64(payload.body.data) + '\n';
    else if (mt === 'text/html' && payload.body?.data) out.html += decodeB64(payload.body.data) + '\n';
    (payload.parts || []).forEach((p) => collectBodies(p, out));
    return out;
}

const htmlToText = (html) => convert(html || '', {
    wordwrap: false,
    selectors: [
        { selector: 'img', format: 'skip' },
        { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
        { selector: 'table', options: { uppercaseHeaderCells: false } },
    ],
});

// Tidy whitespace WITHOUT destroying line structure. Newlines are load-bearing: every cleaner and
// extractor downstream (topMessage, cleanBody, deriveDescription, the "Venue:" label captures) is
// line-based, and collapsing \n to a space silently turns all of them into no-ops. Collapse runs of
// spaces/tabs inside a line, trim each line, and cap blank runs at one.
const normalizeLines = (text) => String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n').map((l) => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const QUOTE_BOUNDARY = /^\s*[-]{2,}\s*Forwarded message|^\s*-{5,}\s*Original Message|^\s*From:\s.+@|^\s*On .+ wrote:/im;

// A PASS-THROUGH FORWARD states nothing of its own above the quote — "FYI, please", "Warm regards,
// Dr. …", "REMINDER, please take cognizance of the trailing mail". There the announcement IS the
// quoted block, and cutting at the boundary throws the whole email away: measured over 1431 broadcast
// mails, 23 were reduced to a median 119 chars, losing the apply-by on the Academic Registration
// notification, the date on a TEDx invite and the venue on club recruitments.
// extract-side topMessage() already falls through when the top is thin — but it runs AFTER this, on a
// body that no longer holds the text, so its fallthrough could never fire.
// Only a top carrying NO data of its own falls through, so a genuine follow-up ("timing changed to
// 5:30 PM") keeps today's behaviour and still wins on its own terms — nothing stale is pulled up.
// The restored text is not trusted blindly: it still faces passesGates()'s sensitive-content wall and
// the Groq privacy screen, which is where quoted PERSONAL mail is dropped (verified against a
// student's fee/enrolment query quoted under an office reply → gate_sensitive).
const WRAPPER_MAX = 400;
const TOP_CARRIES_DATA = /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b|\b\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b|\b\d{1,2}[:.]\d{2}\s*(?:am|pm|hrs)?\b|\b\d{1,2}\s*(?:am|pm)\b|https?:\/\/|\b(?:venue|room\s*no|auditorium|hall)\b/i;

// keep only the top message (strip quoted history / forwarded blocks)
function topOnly(text) {
    if (!text) return '';
    const cut = text.search(QUOTE_BOUNDARY);
    if (!(cut > 0)) return normalizeLines(text);
    const top = normalizeLines(text.slice(0, cut));
    if (top.length < WRAPPER_MAX && !TOP_CARRIES_DATA.test(top)) return normalizeLines(text);
    return top;
}

// A message carries one Authentication-Results header PER HOP, and only the RECEIVING MTA's verdict
// means anything — every upstream one is just a claim the sender's own infrastructure made, and a
// spoofer can forge those freely. Real institute mail arrives with three (Gmail, the IITR amavis relay,
// the IITR Exchange server); the naive "last header wins" read picks IITRESA02's, which reports
// `spf=None smtp.pra=…` and would have rejected 19 of 40 genuine messages. Prefer mx.google.com; else
// the topmost, which per RFC 8601 is the most recent hop.
function authResultsOf(headerList) {
    const all = (headerList || []).filter((h) => /^authentication-results$/i.test(h.name)).map((h) => h.value);
    return all.find((v) => /^\s*mx\.google\.com\b/i.test(v)) || all[0] || '';
}

function normalizeMessage(msg) {
    const headers = {};
    (msg.payload?.headers || []).forEach((h) => { headers[h.name.toLowerCase()] = h.value; });
    const bodies = collectBodies(msg.payload);
    // PREFER PLAIN, BUT NOT WHEN IT HAS LOST THE LINKS.
    //
    // A multipart email carries both a text/plain and a text/html alternative, and most clients write
    // the plain one by flattening every <a href="…">LABEL</a> down to just LABEL. The address is gone.
    // The SAC election notice read "uploaded on the ELECTION COMMISSION PORTAL" with no URL anywhere,
    // so the notice was published with no link and a student had nowhere to click.
    //
    // It looked inconsistent because it depends on the sender: Zimbra writes links into the plain part
    // as "[ https://… | label ]", so those survived, while Outlook-style clients drop them entirely.
    //
    // So: keep plain text as the default — it is cleaner and every downstream extractor is tuned to it
    // — but fall back to the HTML conversion when plain contains NO url and the html does. htmlToText
    // already keeps hrefs; it was simply unreachable unless the plain part was completely empty.
    const HAS_URL = /https?:\/\//i;
    const plain = bodies.plain.trim();
    const fromHtml = bodies.html ? htmlToText(bodies.html) : '';
    const raw = (plain && (HAS_URL.test(plain) || !HAS_URL.test(fromHtml))) ? plain : (fromHtml || plain);
    return {
        message_id: headers['message-id'] || msg.id,
        gmail_id: msg.id,
        thread_id: msg.threadId,
        from: headers.from || '',
        to: headers.to || '',
        // CC matters for ATTRIBUTION. A club routinely mails through a broadcast list and copies its
        // own address, so the club is in Cc while From is only the relay — cinesec@iitr.ac.in reaches
        // students that way. Without this header the club address never enters the pipeline at all and
        // the event is attributed to Institute.
        cc: headers.cc || '',
        subject: headers.subject || '',
        body_text: topOnly(raw).slice(0, 4000),
        internal_date: msg.internalDate ? new Date(Number(msg.internalDate)) : null,
        // Gmail's own verdict on whether the sender is who they claim. The pipeline otherwise trusts the
        // From header verbatim, and iitr.ac.in publishes DMARC `p=quarantine; sp=none` — so mail from any
        // *.iitr.ac.in subdomain is neither quarantined nor rejected, and gate0 accepts subdomains
        // (head@pt.iitr.ac.in and friends are legitimate, so they can't simply be blocked).
        auth_results: authResultsOf(msg.payload?.headers),
    };
}


// Walk a message payload for image attachments; return the LARGEST (a poster, not a signature logo).
// Returns { attachmentId, filename, mimeType, size } or null.
function findImageAttachment(payload) {
    // Allowlist, NOT `startsWith('image/')` — that admits image/svg+xml, which is a script-bearing
    // document, not a picture. Posters are served from /posters/* on the SAME ORIGIN as the app, so an
    // SVG "poster" containing <script> would execute in the app's origin with the auth cookie attached.
    // nosniff does not help: the browser is honouring the declared type, not guessing it.
    const POSTER_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    const imgs = [];
    (function walk(p) {
        if (!p) return;
        const mt = (p.mimeType || '').toLowerCase();
        if (POSTER_TYPES.includes(mt) && p.body?.attachmentId) {
            imgs.push({ attachmentId: p.body.attachmentId, filename: p.filename || 'poster', mimeType: mt, size: p.body.size || 0 });
        }
        (p.parts || []).forEach(walk);
    })(payload);
    if (!imgs.length) return null;
    imgs.sort((a, b) => b.size - a.size);
    return imgs[0];
}

// Fetch one attachment's bytes. Returns a Buffer (or null).
async function getAttachment(messageId, attachmentId) {
    const gmail = gmailClient();
    const { data } = await withRetry(() => gmail.users.messages.attachments.get({ userId: CFG().user, messageId, id: attachmentId }));
    return data?.data ? Buffer.from(data.data, 'base64url') : null;
}

module.exports = {
    isConfigured, verify, isAuthError, listMessageIds, getMessage, getProfile, listHistory, normalizeMessage,
    findImageAttachment, getAttachment,
};
