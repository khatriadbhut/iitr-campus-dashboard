/**
 * Notice display formatting — the card snippet and the detail bullets.
 *
 *   node src/utils/notice.test.mjs
 *
 * Every case here is a real defect found by rendering the 38 live notices and READING them. They are
 * kept because each one is invisible to a "does it crash" check and to most regex sweeps — the text
 * was always well-formed, it was just wrong for a human.
 */
import { bodyPoints, noticeSnippet, isExternalNotice, isNoticeOnFeed } from './notice.js';

let pass = 0;
let fail = 0;
const check = (name, cond, got) => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${got !== undefined ? `\n       got: ${JSON.stringify(got)}` : ''}`); }
};
const points = (body, skip) => bodyPoints(body, skip).map((sg) => sg.map((x) => (x.url ? `[${x.label}]` : x.text)).join('').trim());

console.log('── the action marker leaking into the UI ──');
{
    // EXACT stored body of the live "Provisional List of Convocation Awards 2026" notice.
    const body = '→ Inform the SCSP Office by email by August 23 2026\n\nThe SCSP Office has posted the provisional list of Convocation Awards 2026 on Channel‑I. Students should report any discrepancies by the stated deadline.';
    const p = points(body);
    check('no bullet begins with an arrow', p.every((t) => !/^[→➔•]|^-{1,2}>/.test(t)), p);
    check('the action is its own bullet', p[0] === 'Inform the SCSP Office by email by August 23 2026', p[0]);
    check('the paragraph after it is separate', p.length === 3, p);
    check('snippet does not run the two together without punctuation', !/2026 The SCSP/.test(noticeSnippet(body).text), noticeSnippet(body).text);
}

console.log('\n── abbreviations and initials must not split a sentence ──');
{
    const body = 'The SCSP Office has published the provisional shortlist for the Prof. S.N. Tandon Scholarship in the Department of Chemistry (prize Rs 50,000). Report any discrepancy by 25 August 2026.';
    const p = points(body);
    check('"Prof. S.N. Tandon" stays in one bullet', p[0].includes('Prof. S.N. Tandon Scholarship'), p);
    check('does not produce an "S.N." fragment', !p.includes('S.N.'), p);
    check('exactly two sentences', p.length === 2, p);
    check('snippet does not end at "the Prof."', !/the Prof\.$/.test(noticeSnippet(body).text), noticeSnippet(body).text);
}
{
    const p = points('Open to all IIT Roorkee B. Tech., M. Tech. and Ph.D. students. Apply before the deadline.');
    check('degree abbreviations survive', p[0].includes('B. Tech., M. Tech. and Ph.D. students'), p);
}

console.log('\n── stranded labels left behind by CTA link removal ──');
{
    const p = points('Real sentence about the shortlist.\nNotice: https://channeli.in/x', 'https://channeli.in/x');
    check('a bare "Notice:" bullet is dropped', !p.includes('Notice:'), p);
    check('the real sentence survives', p.length === 1, p);
}
{
    const p = points('Queries: udyanutsav-rb@rb.nic.in.');
    check('a label WITH content is kept', p.length === 1 && p[0].startsWith('Queries:'), p);
}

console.log('\n── pipeline bullets and line breaks ──');
{
    const p = points('Head line here.\n• First detail\n• Second detail');
    check('pipeline "•" markers are stripped', p.every((t) => !t.startsWith('•')), p);
    check('each line becomes its own point', p.length === 3, p);
}
{
    const p = points('Temperature dropped -5 degrees overnight.');
    check('a leading-hyphen number is NOT eaten', p[0].includes('-5 degrees'), p);
}

console.log('\n── the EXTERNAL flag is server-owned, never guessed ──');
{
    check('true only when the server says so', isExternalNotice({ is_external: true }) === true);
    check('false when absent', isExternalNotice({ title: 'International Hackathon' }) === false);
    check('null-safe', isExternalNotice(null) === false);
}

// ── isNoticeOnFeed: when a notice leaves the feed ────────────────────────────────────────────────
{
    const NOW = new Date(2026, 7, 27, 12, 0, 0).getTime();          // 27 Aug 2026, midday
    const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
    const n = (o) => ({ published_at: daysAgo(0), ...o });

    // 1 — A STATED DATE GOVERNS. Course Drop is the case that forces this: mailed 5 Aug for a
    // 5 Oct deadline, so ANY age cap would hide it a month before the date it announces.
    const courseDrop = { deadline: '2026-10-05', is_opportunity: false, published_at: daysAgo(22) };
    check('Course Drop: 22 days old, deadline 5 Oct -> still on the feed', isNoticeOnFeed(courseDrop, NOW) === true);
    check('a deadline TODAY is still open (you have until end of day)',
        isNoticeOnFeed({ deadline: '2026-08-27', published_at: daysAgo(30) }, NOW) === true);
    check('a deadline YESTERDAY is gone',
        isNoticeOnFeed({ deadline: '2026-08-26', published_at: daysAgo(1) }, NOW) === false);
    check('an event_date works the same way',
        isNoticeOnFeed({ event_date: '2026-09-01', published_at: daysAgo(40) }, NOW) === true);
    check('an old notice with a FUTURE deadline is never aged out',
        isNoticeOnFeed({ deadline: '2026-12-31', published_at: daysAgo(200) }, NOW) === true);

    // 2 — UNDATED OPPORTUNITY: 10 days
    check('undated opportunity at 9 days: kept',
        isNoticeOnFeed(n({ is_opportunity: true, published_at: daysAgo(9) }), NOW) === true);
    check('undated opportunity at 11 days: gone',
        isNoticeOnFeed(n({ is_opportunity: true, published_at: daysAgo(11) }), NOW) === false);

    // 3 — UNDATED OTHER: 7 days. The Dog Menace / SAC-route case.
    check('undated info at 6 days: kept',
        isNoticeOnFeed(n({ is_opportunity: false, published_at: daysAgo(6) }), NOW) === true);
    check('undated info at 8 days: gone (Dog Menace does not live forever)',
        isNoticeOnFeed(n({ is_opportunity: false, published_at: daysAgo(8) }), NOW) === false);
    check('an undated OPPORTUNITY outlives undated info at day 8',
        isNoticeOnFeed(n({ is_opportunity: true, published_at: daysAgo(8) }), NOW) === true);

    // never hide something we cannot date
    check('no date and no clock at all -> kept', isNoticeOnFeed({ is_opportunity: false }, NOW) === true);
    check('an unparseable deadline -> kept', isNoticeOnFeed({ deadline: 'soon', published_at: daysAgo(99) }, NOW) === true);
    check('null-safe', isNoticeOnFeed(null, NOW) === false);
}

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail ? 1 : 0);
