const path = require('path');

/**
 * PDF text-layer extraction (no OCR).
 *
 * pdfjs-dist v4 is ESM-only and this backend is CommonJS, so we load the legacy
 * build via dynamic import() and cache the promise. Text is returned per page in
 * reading order (the spike proved reading order survives even when the visual
 * table wraps across lines — we reconstruct rows later from that stream, NOT from
 * 2D geometry).
 */

let pdfjsPromise = null;
function loadPdfjs() {
    if (!pdfjsPromise) {
        pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
    }
    return pdfjsPromise;
}

// Fonts shipped inside the pdfjs-dist package — pointing at them silences the
// "failed to fetch standard font" warnings and keeps glyph extraction clean.
const STANDARD_FONT_DATA_URL = path.join(
    path.dirname(require.resolve('pdfjs-dist/package.json')),
    'standard_fonts/'
);

// Below this many non-whitespace characters we treat the PDF as having no usable
// text layer (i.e. it's a scan/image) and bail out with a clear message.
const MIN_TEXT_CHARS = 200;

/**
 * @param {Buffer|Uint8Array} buffer
 * @returns {Promise<{pages:string[], text:string, charCount:number, numPages:number, hasTextLayer:boolean}>}
 */
async function extractText(buffer) {
    const pdfjs = await loadPdfjs();
    // A Node Buffer IS a Uint8Array subclass, but pdfjs rejects Buffer specifically —
    // copy into a plain Uint8Array.
    const data = new Uint8Array(buffer);

    // ERRORS only — hide pdfjs's noisy per-font warnings in a server context.
    if (typeof pdfjs.setVerbosityLevel === 'function' && pdfjs.VerbosityLevel) {
        pdfjs.setVerbosityLevel(pdfjs.VerbosityLevel.ERRORS);
    }

    let doc;
    try {
        doc = await pdfjs.getDocument({
            data,
            standardFontDataUrl: STANDARD_FONT_DATA_URL,
            isEvalSupported: false,
            useSystemFonts: false,
            verbosity: 0,
        }).promise;
    } catch (err) {
        const e = new Error('The uploaded file could not be read as a PDF.');
        e.code = 'PDF_UNREADABLE';
        e.cause = err;
        if (process.env.ACAL_DEBUG) console.error('pdfjs getDocument failed:', err);
        throw e;
    }

    const pages = [];
    // Cap pages so a crafted PDF that declares a huge page count can't spin CPU / allocate unbounded.
    // Real academic calendars are a handful of pages; 40 is comfortable headroom.
    const maxPages = Math.min(doc.numPages, 40);
    for (let i = 1; i <= maxPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
            .map((it) => (it && typeof it.str === 'string' ? it.str : ''))
            .join(' ');
        pages.push(text);
    }

    try {
        await doc.cleanup();
        await doc.destroy();
    } catch (_) { /* best-effort cleanup */ }

    const text = pages.join('\n');
    const charCount = text.replace(/\s/g, '').length;

    return {
        pages,
        text,
        charCount,
        numPages: doc.numPages,
        hasTextLayer: charCount >= MIN_TEXT_CHARS,
    };
}

module.exports = { extractText, MIN_TEXT_CHARS };
