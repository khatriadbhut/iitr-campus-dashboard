// URL sanitizers for values that originate from untrusted content (ingested email bodies, poster OCR,
// admin free-text). React escapes text nodes, but NOT `href` schemes or CSS `url()` values — so a
// `javascript:` href or a `)`-breakout in a background url() would execute / inject. Gate both here.

// http(s) only. Anything else (javascript:, data:, vbscript:, relative, blank) collapses to '#'.
export function safeHref(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : '#';
}

// A CSS `url("…")` token for http(s) images only, with the URL percent-encoded so it cannot break out
// of the quotes/parens and inject further CSS declarations. Returns '' for anything unsafe.
export function safeCssUrl(u) {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u.trim())) return '';
  const enc = encodeURI(u.trim())
    .replace(/\(/g, '%28').replace(/\)/g, '%29')
    .replace(/'/g, '%27').replace(/"/g, '%22');
  return `url("${enc}")`;
}
