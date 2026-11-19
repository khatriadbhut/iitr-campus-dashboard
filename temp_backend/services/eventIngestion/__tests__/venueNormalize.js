/**
 * Scores services/eventIngestion/venue.js against the measured corpus (see venueTaxonomy.js, which
 * writes /tmp/venueTaxonomy.json). Run this after touching any rule in venue.js.
 *
 * From temp_backend/: node services/eventIngestion/__tests__/venueNormalize.js
 */
const fs = require('fs');
const { normalizeVenue } = require('./../venue');

const { rows } = JSON.parse(fs.readFileSync('/tmp/venueTaxonomy.json', 'utf8'));
const out = new Map(); let dropped = 0;
for (const [v, n] of rows) {
    const r = normalizeVenue(v);
    if (!r) { dropped += n; console.log(`  DROP  ${JSON.stringify(v)}`); continue; }
    out.set(r, (out.get(r) || 0) + n);
    if (r !== v) console.log(`  ${JSON.stringify(v).padEnd(56)} -> ${JSON.stringify(r)}`);
}
console.log(`\n${rows.length} distinct raw -> ${out.size} distinct normalised   ·   dropped as non-venue: ${dropped} mentions`);
console.log('\nTOP NORMALISED VENUES');
[...out.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([v, n]) => console.log(`  ${String(n).padStart(3)}  ${v}`));
module.exports = { normalizeVenue };
