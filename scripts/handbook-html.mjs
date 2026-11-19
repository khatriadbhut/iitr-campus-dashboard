import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC  = path.join(ROOT, 'docs/ONBOARDING.md');
const OUT  = process.argv[2];

let md = fs.readFileSync(SRC, 'utf8');

// ── The document's own H1 becomes the title page; strip it from the body. ────
md = md.replace(/^# IITR Campus Dashboard — The Complete Developer Handbook\n/, '');

// ── Per-code-block sizing ────────────────────────────────────────────────────
// A4 minus 16mm margins minus padding ≈ 172mm ≈ 487pt of printable width.
// A monospace glyph advances ~0.602em, so a block whose widest line is N chars
// needs font-size ≤ 780/N pt to fit. Cap at 8.5pt so ordinary snippets stay
// comfortable and only the wide ASCII diagrams shrink.
const widest = (code) => code.split('\n').reduce((m, l) => Math.max(m, [...l].length), 0);

const renderer = new marked.Renderer();
const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

renderer.code = ({ text, lang }) => {
  const n = widest(text);
  const lines = text.split('\n').length;
  const fs_ = Math.min(8.5, n > 0 ? 780 / n : 8.5);
  // A block that is very wide, or too tall to fit a page anyway, is allowed to
  // split across pages. Keeping `break-inside: avoid` on those buys nothing and
  // leaves half-empty pages behind it.
  const cls = (n > 95 || lines > 22) ? 'wide' : '';
  return `<pre class="${cls}" style="font-size:${fs_.toFixed(2)}pt"><code class="lang-${lang || 'text'}">${escapeHtml(text)}</code></pre>`;
};

// Heading ids that match the document's own in-page TOC anchors.
// GitHub's slugger, exactly: lowercase, drop everything that is not
// [a-z0-9 _-], then map each single space to a single hyphen. NOT collapsing
// runs of spaces is the whole point — "Part 0 — What…" loses the em-dash and
// keeps both surrounding spaces, so the real anchor is "part-0--what…" with a
// DOUBLE hyphen. Collapse it and every link in the document's own TOC breaks.
const slug = (s) => s.toLowerCase().trim()
  .replace(/<[^>]+>/g, '')
  .replace(/[^\p{L}\p{N} _-]+/gu, '')
  .replace(/ /g, '-');

const seen = new Map();
renderer.heading = function ({ tokens, depth }) {
  const text = this.parser.parseInline(tokens);
  let id = slug(tokens.map(t => t.raw).join(''));
  const n = (seen.get(id) || 0) + 1; seen.set(id, n);
  if (n > 1) id += `-${n - 1}`;
  return `<h${depth} id="${id}">${text}</h${depth}>\n`;
};

marked.setOptions({ renderer, gfm: true, breaks: false, mangle: false, headerIds: false });
let body = marked.parse(md);

// ── Tag the per-section skip lines ───────────────────────────────────────────
// Every `##` carries one of these. They are plain markdown (an italic lead-in) so
// they read correctly on GitHub; here they become a class the print stylesheet
// can turn into a margin note.
body = body.replace(/<p><em>Skip if:<\/em>/g, '<p class="skip skip-optional"><em>Skip if:</em>');
body = body.replace(/<p><em>Read this one<\/em>/g, '<p class="skip skip-core"><em>Read this one</em>');
body = body.replace(/<p><em>Assumes:<\/em>/g, '<p class="skip skip-needs"><em>Assumes:</em>');

// ── Flag callout blockquotes so warnings read as warnings ────────────────────
body = body.replace(/<blockquote>\s*<p><strong>Warning/g, '<blockquote class="warn"><p><strong>Warning');

const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>IITR Campus Dashboard — Developer Handbook</title>
<style>
@page {
  size: A4;
  margin: 18mm 16mm 20mm 16mm;
}
@page :first { margin: 0; }

:root {
  --ink:      #14100f;
  --ink-soft: #4a4340;
  --rule:     #ddd6d2;
  --brand:    #713364;
  --brand-lo: #f6eef4;
  --gold:     #8a6d00;
  --code-bg:  #f7f5f4;
  --amber:    #8a5a00;
  --amber-bg: #fdf6e8;
}

* { box-sizing: border-box; }

html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

body {
  font-family: Georgia, Charter, 'Times New Roman', serif;
  font-size: 10.2pt;
  line-height: 1.58;
  color: var(--ink);
  margin: 0;
  hyphens: auto;
  -webkit-hyphens: auto;
  text-rendering: optimizeLegibility;
}

/* ── Title page ───────────────────────────────────────────────────────────── */
.cover {
  page-break-after: always;
  break-after: page;
  height: 297mm;
  padding: 52mm 22mm 22mm;
  display: flex;
  flex-direction: column;
  border-top: 9mm solid var(--brand);
}
.cover .eyebrow {
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 9.5pt; font-weight: 600; letter-spacing: .22em;
  text-transform: uppercase; color: var(--brand); margin-bottom: 10mm;
}
.cover h1 {
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 33pt; line-height: 1.1; font-weight: 700;
  letter-spacing: -.02em; margin: 0 0 6mm; color: var(--ink);
  border: 0; padding: 0;
}
.cover .sub {
  font-size: 13pt; color: var(--ink-soft); line-height: 1.5;
  max-width: 118mm; margin: 0 0 auto;
}
.cover .rule { width: 34mm; height: 3px; background: var(--gold); margin: 9mm 0; }
.cover .meta {
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 9pt; color: var(--ink-soft); line-height: 1.9;
  border-top: 1px solid var(--rule); padding-top: 6mm;
}
.cover .meta b { color: var(--ink); font-weight: 600; }

/* ── Headings ─────────────────────────────────────────────────────────────── */
h1, h2, h3, h4 {
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  color: var(--ink); font-weight: 700; letter-spacing: -.012em;
  break-after: avoid; page-break-after: avoid;
}
h1 {
  font-size: 21pt; line-height: 1.16;
  margin: 0 0 9mm; padding: 0 0 4mm;
  border-bottom: 2.5px solid var(--brand);
  color: var(--brand);
  break-before: page; page-break-before: always;
}
h1:first-of-type { break-before: auto; page-break-before: auto; }
h2 {
  font-size: 14pt; margin: 9mm 0 3.5mm; padding-bottom: 1.6mm;
  border-bottom: 1px solid var(--rule);
}
h3 { font-size: 11.6pt; margin: 7mm 0 2.5mm; }
h4 { font-size: 10.4pt; margin: 5mm 0 2mm; color: var(--ink-soft); }

p { margin: 0 0 3.4mm; orphans: 3; widows: 3; }
strong { font-weight: 700; }
em { font-style: italic; }

/* ── Lists ────────────────────────────────────────────────────────────────── */
ul, ol { margin: 0 0 3.6mm; padding-left: 6.5mm; }
li { margin-bottom: 1.4mm; }
li > ul, li > ol { margin-top: 1.4mm; }

/* ── Code ─────────────────────────────────────────────────────────────────── */
code {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  font-size: .855em;
  background: var(--code-bg);
  border: 1px solid #eae5e2;
  border-radius: 2.5px;
  padding: .5px 3px;
  color: #5c2b52;
  word-break: break-word;
}
pre {
  font-family: 'SF Mono', Menlo, Consolas, monospace;
  background: var(--code-bg);
  border: 1px solid #e6e0dc;
  border-left: 3px solid var(--brand);
  border-radius: 3px;
  padding: 3.2mm 3.6mm;
  margin: 0 0 4mm;
  line-height: 1.42;
  overflow: visible;
  white-space: pre;
  break-inside: avoid; page-break-inside: avoid;
}
/* Long ASCII diagrams may legitimately span a page; let them. */
pre.wide { break-inside: auto; page-break-inside: auto; }
pre code {
  background: none; border: 0; padding: 0; font-size: inherit;
  color: var(--ink); white-space: pre;
}

/* ── Tables ───────────────────────────────────────────────────────────────── */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 4.5mm;
  font-size: 8.9pt;
  line-height: 1.42;
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
}
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
th {
  text-align: left; font-weight: 700; color: #fff; background: var(--brand);
  padding: 1.9mm 2.4mm; border: 1px solid var(--brand);
  font-size: 8.5pt; letter-spacing: .01em;
}
td {
  padding: 1.7mm 2.4mm; border: 1px solid var(--rule); vertical-align: top;
}
tbody tr:nth-child(even) td { background: #faf8f7; }
td code, th code { font-size: .88em; padding: 0 2px; }

/* ── Blockquotes / callouts ───────────────────────────────────────────────── */
blockquote {
  margin: 0 0 4mm; padding: 2.8mm 4mm;
  border-left: 3px solid var(--brand);
  background: var(--brand-lo);
  color: var(--ink);
  break-inside: avoid; page-break-inside: avoid;
}
blockquote.warn { border-left-color: var(--amber); background: var(--amber-bg); }
blockquote p:last-child { margin-bottom: 0; }
blockquote > p { font-size: 9.8pt; }

/* ── The routing tables at the front ──────────────────────────────────────── */
/* These two tables are the most-used surface in the book — the whole
   "read at your own level" system routes through them — so they get more
   weight than an ordinary table and are kept off a page boundary.          */
#start-here {
  font-size: 16pt; border: 0; margin-top: 4mm;
  padding: 0 0 0 4mm; border-left: 4px solid var(--gold);
}
#start-here + p + table,
#already-know-some-of-it-skip-ahead + p + table {
  font-size: 9.3pt;
  break-inside: avoid; page-break-inside: avoid;
}
#start-here + p + table td:nth-child(2) { font-weight: 600; }
#already-know-some-of-it-skip-ahead + p + table td:last-child { font-weight: 600; }

/* ── Level banner + "short version" box ───────────────────────────────────── */
/* Targeted structurally, not by class, so the markdown stays plain markdown and
   still reads correctly on GitHub: every Part is
       # Part N — …
       **Level:** … (a paragraph)
       > **The short version**  (a blockquote of bullets)               */
h1 + p {
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 8.6pt; line-height: 1.5; color: var(--ink-soft);
  background: #faf7f9; border: 1px solid #e9dfe6; border-radius: 3px;
  padding: 2mm 3mm; margin: -5mm 0 4.5mm;
  break-after: avoid; page-break-after: avoid;
}
h1 + p strong { color: var(--brand); font-weight: 700; }

h1 + p + blockquote {
  background: #fff; border: 1px solid var(--rule); border-left: 3.5px solid var(--gold);
  padding: 3.4mm 4mm 3.4mm 4.5mm; margin: 0 0 6mm;
  break-inside: auto; page-break-inside: auto;
}
h1 + p + blockquote > p:first-child {
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 8.4pt; font-weight: 700; letter-spacing: .13em; text-transform: uppercase;
  color: var(--gold); margin: 0 0 2.4mm;
}
h1 + p + blockquote ul { margin: 0; padding-left: 5mm; }
h1 + p + blockquote li { margin-bottom: 1.9mm; font-size: 9.6pt; line-height: 1.5; }
h1 + p + blockquote li:last-child { margin-bottom: 0; }

/* ── Per-section skip lines ───────────────────────────────────────────────── */
/* A quiet one-line verdict under each h2: can I skip this, or must I not?
   Deliberately understated — it is read in a glance, never studied.        */
p.skip {
  font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 8.4pt; line-height: 1.45;
  margin: -1.5mm 0 3.6mm; padding: 0 0 0 3mm;
  border-left: 2px solid var(--rule);
  color: #6f6764;
  break-after: avoid; page-break-after: avoid;
}
p.skip em { font-style: normal; font-weight: 700; letter-spacing: .02em; }
p.skip-optional { border-left-color: #cfc7c3; }
p.skip-optional em { color: #8a807c; }
p.skip-core { border-left-color: var(--gold); }
p.skip-core em { color: var(--gold); }

/* ── Self-assessment checklists ───────────────────────────────────────────── */
/* Real checkboxes do not print reliably; draw the box instead. */
li:has(> input[type="checkbox"]) { list-style: none; margin-left: -4mm; }
input[type="checkbox"] {
  appearance: none; -webkit-appearance: none;
  width: 3.1mm; height: 3.1mm; margin: 0 2.2mm 0 0;
  border: 1px solid #9a9391; border-radius: 1px;
  background: #fff; vertical-align: -0.3mm;
}

/* ── The expert track table ───────────────────────────────────────────────── */
/* A general-sibling selector would match EVERY table after this heading — i.e. every table in the book,
   which right-aligned the first column of all of them. Adjacency instead: the
   expert-track table is the one directly after this heading's two paragraphs. */
#the-expert-track--worth-reading-even-if-you-are-senior + p + p + table td:first-child {
  text-align: center; font-weight: 700; color: var(--brand);
}

/* ── Rules & links ────────────────────────────────────────────────────────── */
hr { border: 0; border-top: 1px solid var(--rule); margin: 7mm 0; }
a { color: var(--brand); text-decoration: none; border-bottom: .5px solid #d3bccb; }
h1 a, h2 a, h3 a { border: 0; color: inherit; }

/* The document's own table of contents — keep it on its own page, tighten it. */
#table-of-contents + ul {
  columns: 1; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  font-size: 10pt; line-height: 1.85; list-style: none; padding-left: 0;
}
#table-of-contents + ul li { margin: 0; border-bottom: .5px dotted var(--rule); padding: .8mm 0; }
#table-of-contents + ul a { border: 0; }
</style></head>
<body>

<section class="cover">
  <div class="eyebrow">IIT Roorkee · Campus Dashboard</div>
  <h1>The Complete<br>Developer Handbook</h1>
  <div class="rule"></div>
  <p class="sub">From "I have never seen this codebase" to maintaining it — the basics,
  the database, every API endpoint, a file-by-file code tour, the feature deep dives,
  deployment, and the traps.</p>
  <div class="meta">
    <div><b>Repository</b> &nbsp; Campus-Dashboard-Event-Planner</div>
    <div><b>Stack</b> &nbsp; React 19 · Vite · Node · Express · PostgreSQL · Sequelize</div>
    <div><b>Source</b> &nbsp; docs/ONBOARDING.md</div>
    <div><b>Written against the code as of</b> &nbsp; ${today}</div>
  </div>
</section>

${body}
</body></html>`;

fs.writeFileSync(OUT, html);
console.log('HTML written:', OUT, (html.length / 1024).toFixed(0) + ' KB');
