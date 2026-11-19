/**
 * The deterministic deadline backstop.
 *
 *   node services/eventIngestion/__tests__/statedDeadline.test.js
 *
 * Two cases here are not hypotheticals — they are the exact notices that went wrong in production on
 * 2026-08-26, and they pull in opposite directions:
 *
 *   · GCI Program  — the mail says "Deadline: September 10th" and the notice was published with none.
 *                    The backstop MUST fill this.
 *   · UPLB Exchange — the mail says "Deadline September 10" AND "Referee Deadline September 12", and
 *                    the pipeline took the later one, telling students they had two extra days.
 *                    The backstop MUST refuse rather than pick.
 *
 * The refusal is the load-bearing half. Anyone tempted to "improve" this by picking the earliest or the
 * first match should read the UPLB case first: nothing in that text marks which date is authoritative,
 * so a confident answer is a wrong answer waiting to happen.
 */
const { statedDeadline } = require('../statedDeadline');

let pass = 0, fail = 0;
const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `\n     got ${JSON.stringify(got)}  want ${JSON.stringify(want)}`}`);
};
const date = (t) => { const r = statedDeadline(t, Date.parse('2026-08-27')); return r ? r.date : null; };

console.log('── the two production cases ──');
check('GCI: "Deadline: September 10th" is recovered',
    date('Continuous learning opportunities within our lab as well. - Deadline: September 10th For detailed information regarding the program overview, schedule and more'),
    '2026-09-10');
check('UPLB: a student deadline AND a referee deadline → REFUSE',
    date('Study period One semester. Deadline September 10, 2026 Referee Deadline September 12, 2026 To apply for nomination from IITR'),
    null);

console.log('\n── phrasings that should be recovered ──');
check('Last date to apply is 30th August 2026', date('Last date to apply is 30th August 2026 .'), '2026-08-30');
check('Registration Deadline: 31st August 2026', date('Key Details: - Registration Deadline: 31st August 2026 - Platform: SIDH'), '2026-08-31');
check('Last date for submitting application: August 31, 2026', date('Winners receive their awards at the time of the Convocation. Last date for submitting application: August 31, 2026.'), '2026-08-31');
check('Apply by 15 Sep', date('Entries are invited. Apply by 15 Sep using the link below.'), '2026-09-15');
check('a year in the text beats the fallback', date('Deadline: 5 January 2027'), '2027-01-05');
check('no year → assumes the mail’s year', date('Deadline: 3 October'), '2026-10-03');

console.log('\n── it stays silent rather than guessing ──');
check('a bare date with no cue is ignored',
    date('The 3rd edition of the Cyclothon is scheduled for 5th September 2026. Fitness test on 23rd August.'), null);
check('"before" in ordinary prose is not a deadline cue',
    date('How is due diligence conducted before an investment is made? 12 August is mentioned elsewhere.'), null);
check('a cue with no date after it', date('Please note the deadline given in the attached flyer.'), null);
check('empty input', date(''), null);
check('null input', date(null), null);
check('a nonsense month', date('Deadline: 10 Smarch'), null);
check('day out of range', date('Deadline: 45 September'), null);

console.log('\n── ambiguity is always refused ──');
check('two different cue-dates → nothing',
    date('Deadline: 10 September. Late deadline: 20 September.'), null);
check('the SAME date stated twice is not ambiguous',
    date('Deadline: 10 September. Reminder — the deadline is 10 September.'), '2026-09-10');

console.log('\n── it reports which phrase it matched ──');
{
    const r = statedDeadline('Applications close 12 September 2026', Date.parse('2026-08-27'));
    check('cue is reported', r && r.cue, 'applications close');
}

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail ? 1 : 0);
