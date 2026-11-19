/**
 * Groq assist — a SANDBOXED, optional helper for the parser. It can only ever
 * *suggest*; every output is validated by the deterministic side before use, and
 * anything unavailable/malformed fails open (the pipeline runs pure-deterministic).
 *
 * Enabled only when LLM_PROVIDER=groq and GROQ_API_KEY are set. Never on the
 * hard-dependency path — see index.js for where these are called and guarded.
 */

const axios = require('axios');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const TIMEOUT_MS = 8000;

function isEnabled() {
    return String(process.env.LLM_PROVIDER || '').toLowerCase() === 'groq' && !!process.env.GROQ_API_KEY;
}

// Low-level call → parsed JSON object, or null on ANY failure (fails open).
async function callGroq(system, user) {
    if (!isEnabled()) return null;
    try {
        const res = await axios.post(
            GROQ_URL,
            {
                model: MODEL,
                temperature: 0,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
            },
            {
                timeout: TIMEOUT_MS,
                headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
            }
        );
        const content = res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content;
        if (!content) return null;
        return JSON.parse(content);
    } catch (err) {
        console.warn('[groq] assist unavailable, continuing deterministic:', err.message);
        return null;
    }
}

/**
 * (D) Classifier tie-breaker — used ONLY when the deterministic classifier is
 * unsure. Returns 'general' | 'mba_or_other' | 'not_calendar' | null.
 */
async function classifyDocument(pages) {
    const text = (pages || []).join('\n').slice(0, 2500);
    const out = await callGroq(
        'You classify an uploaded PDF for an IIT Roorkee campus app. Reply ONLY with JSON {"kind": one of "general" | "mba_or_other" | "not_calendar"}. "general" = the general (non-MBA / undergraduate) academic calendar. "mba_or_other" = an MBA academic calendar or some other institution\'s calendar. "not_calendar" = anything that is not an academic calendar. If unsure, prefer "mba_or_other".',
        `Document text:\n"""${text}"""`
    );
    const kind = out && out.kind;
    return ['general', 'mba_or_other', 'not_calendar'].includes(kind) ? kind : null;
}

/**
 * (A) Outlier date suggestions — for the ~1-2 rows the deterministic parser
 * flagged (free-text / "OR" / split ranges). Returns raw suggestions
 * [{ title, startDate, endDate }] or null. The CALLER validates them (format +
 * within the calendar's date window) before showing anything — never trusted raw.
 */
async function suggestOutlierDates(rows, semester) {
    if (!rows || rows.length === 0) return null;
    const list = rows.map((r, i) => `${i + 1}. title: ${r.title}\n   raw: ${r.rawText || r.rawDateText || ''}`).join('\n');
    const out = await callGroq(
        'You resolve ambiguous dates from an IIT Roorkee academic calendar. For each item, infer a best-guess start and end date in strict YYYY-MM-DD, using the given semester for the year. If a date is genuinely undecided (e.g. "first week of September"), pick the most reasonable concrete range. Reply ONLY with JSON {"suggestions":[{"title": string, "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD"}]}. Never include commentary.',
        `Semester: ${semester || 'unknown'}\nItems:\n${list}`
    );
    return out && Array.isArray(out.suggestions) ? out.suggestions : null;
}

module.exports = { isEnabled, classifyDocument, suggestOutlierDates };
