/**
 * What earns the pinned IMPORTANT band.
 *
 *   node services/eventIngestion/__tests__/importance.test.js
 *
 * The band is only worth having if it is scarce. Measured 2026-08-22 the old rule pinned 103 of 171
 * notices — 60% — putting external hackathons and a football-field closure above fee payment. The rule
 * is now "ignoring this costs you something", and these cases are the ones that defined its edges,
 * each taken from a real notice.
 */
const { isImportantNotice } = require('../index');

let pass = 0, fail = 0;
const check = (name, got, want = true) => {
    const ok = got === want;
    ok ? pass++ : fail++;
    console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : `  got ${got}`}`);
};

console.log('── money, however it is spelled ──');
// These four were unpinned because the cue list only knew cash-shaped words.
check('a scholarship', isImportantNotice('Shraman Foundation Scholarship Program', 'scholarship', false, true));
check('an "Internship AWARD" (₹20,000)', isImportantNotice('Applications for Viva Gaur Memorial Internship Award', 'scholarship', false, true));
check('"Innovation AWARDS" (₹50K)', isImportantNotice('Inviting applications for Professional Development & Innovation awards', 'scholarship', false, true));
check('benefit in kind — a semester of free textbooks', isImportantNotice('TBLS Books Distribution Schedule', 'resource', false, false));

console.log('\n── an action the institute requires ──');
check('course drop', isImportantNotice("Option for 'Course Drop' on AIS portal.", 'notice', false, true));
check('fee payment', isImportantNotice('Fee payment for Autumn Semester', 'fee', false, false));
check('an institute holiday you would walk into', isImportantNotice('Institute Holiday on account of Raksha Bandhan', 'notice', false, false));

console.log('\n── outside bodies: a contest is not an obligation ──');
check('an external hackathon, even with a deadline', isImportantNotice('CMPDI Hackathon on R&D 2026', 'competition', true, true), false);
check('an external drone challenge', isImportantNotice('NIDAR 2026-2027 Drone Innovation Challenge', 'competition', true, true), false);
check('an external scholarship with no closing date', isImportantNotice('SBI Platinum Jubilee Asha Scholarship Program-2026', 'scholarship', true, false), false);

console.log('\n── but an outside CAREER DEADLINE is a career event ──');
// The ruling that lifted the blanket veto, and the line drawn under it: the DATE is what separates a
// closing job application from an undated programme announcement.
check('Jane Street SEE, closing 27 Sep', isImportantNotice("Jane Street's SEE Program - Please Share!", 'recruitment', true, true));
check('the same programme with no deadline', isImportantNotice("Jane Street's SEE Program - Please Share!", 'recruitment', true, false), false);
check('an undated external government programme', isImportantNotice('Launch of Yuva Sangam Phase VII', 'recruitment', true, false), false);

console.log('\n── a club intake is important; an outside job ad is not ──');
check('a club recruitment, undated', isImportantNotice('HELIOS is Open for Recruitment!!!', 'recruitment', false, false));
check('an internship AT a named firm is suppressed', isImportantNotice('Internship at Goldman Sachs - applications open', 'recruitment', false, true), false);
// "at <Capitalised>" also matches a PLACE. This IITR-run exchange was being read as an outside job ad.
check('"Exchange Program at UPLB" is a place, not an employer', isImportantNotice('Call for Applications: Students Exchange Program at UPLB Philippines', 'recruitment', false, true));

console.log('\n── things that must NOT be pinned ──');
check('an ordinary talk', isImportantNotice('An invited talk on DAG Schedulers', 'notice', false, false), false);
check('a platform launch relabelled off "recruitment"', isImportantNotice('DISCOVR: One Platform for All Club Opportunities', 'resource', false, false), false);
check('a directory listing', isImportantNotice('College Startup Directory', 'resource', false, false), false);

console.log(`\n${pass}/${pass + fail} passed.`);
process.exit(fail ? 1 : 0);
