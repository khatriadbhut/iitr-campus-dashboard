/**
 * Venue normaliser regressions. Every fixture is a string that actually appeared in a year of
 * student-notices mail (1025 emails, 213 with a venue, 145 distinct strings) — nothing invented.
 * The corpus-wide scorer is __tests__/venueNormalize.js; this file is the part that must never break.
 *
 * From temp_backend/: node services/eventIngestion/__tests__/venue.test.js
 */
const { normalizeVenue } = require('./../venue');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
    if (got === want) { pass++; console.log(`✅ ${label}`); }
    else { fail++; console.log(`❌ ${label}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`); }
};
const t = (label, input, want) => eq(label, normalizeVenue(input), want);

// ── one spelling per place ────────────────────────────────────────────────────────────────────────
t('APJ AKB collapses to APJ', 'APJ-AKB 205', 'APJ-205');
t('APJAKB collapses to APJ', 'APJAKB-205', 'APJ-205');
t('en-dash separator', 'APJ–205', 'APJ-205');
t('spaced en-dash', 'APJ AKB – 004', 'APJ-004');
t('full building name', 'APJ Abdul Kalam Building, Room 103 (APJ-103)', 'APJ-103');
t('the word Block is redundant', 'APJ Block, Room No. 201', 'APJ-201');
t('Room No. form', 'APJ Block Room No. 205', 'APJ-205');
t('GB is Gargi Block', 'GB 202', 'Gargi Block-202');
t('Gargi Block typo in source', 'GB (G argi block) -Room No 309', 'Gargi Block-309');
t('Mac Audi is MAC Auditorium', 'Mac Audi', 'MAC Auditorium');
t('lowercase Mac', 'Mac Auditorium', 'MAC Auditorium');
t('LBS Stadium is LBS Ground', 'LBS Stadium', 'LBS Ground');
t('Lal Bahadur Shastri spelled out', 'Lal Bahadur Shastri Stadium, IIT Roorkee', 'LBS Ground');
t('bare LBS', 'LBS', 'LBS Ground');

// ── initialisms nobody outside the department reads ───────────────────────────────────────────────
t('Pradeep Kapse is the Mechanical auditorium', 'Pradeep Kapse Auditorium, MIED, IIT Roorkee', 'Mechanical Dept Auditorium');
t('HRED is Hydro', 'Auditorium HRED, IIT Roorkee', 'Hydro Dept Auditorium');
t('BSBE is Biosciences', 'BSBE Auditorium', 'Biosciences Dept Auditorium');
t('CSED is Computer Science', 'Conference Room, CSED', 'Conference Room, Computer Science Dept');
t('WRD&M is Water Resources', 'Lecture Theatre, Department of WRD&M, IIT Roorkee', 'Lecture Theatre, Water Resources Dept');
// …but the ones students actually say are left alone
t('DoMS stays DoMS', 'LR1, Department of Management Studies, IIT Roorkee', 'LR1, DoMS');
t('MGCL stays MGCL', 'Circulation Counter, MGCL, IIT Roorkee', 'Circulation Counter, MGCL');
t('DoD spelled out in full', 'Department of Design (DoD), IIT Roorkee', 'Department of Design');
t('qualified OAT stays OAT', 'SAC OAT (1st Floor)', 'SAC OAT (1st Floor)');
t('bare OAT names no place', 'OAT', null);

// ── the venue swallowing the next field (Gmail flattens the whole mail onto one line) ─────────────
t('trailing Time: label', 'MAC Auditorium ⏰ Time: 6:15 PM', 'MAC Auditorium');
t('trailing Eligibility: label', 'SAC Ground Floor 🎓 Eligibility: Open for all UG, PG & PhD students', 'SAC Ground Floor');
t('trailing prose', 'APJAKB 501 👉 Please arrive 15 minutes early to settle in', 'APJ-501');
t('trailing relative clause', 'APJ-AKB 205, which will dive into how these models see the images', 'APJ-205');
t('leading clock time', '3:00 PM in the Committee Room', 'Committee Room');
t('a later Venue: is the real answer', 'Test Details 📅 Date: 15th February 2026 ⏰ Time: 6:00 PM 🏫 Venue: APJ 104', 'APJ-104');

// ── multi-room and multi-venue ────────────────────────────────────────────────────────────────────
t('ampersand rooms', 'APJ-004 & 005', 'APJ-004/005');
t('comma rooms', 'APJAKB 003, 004, 005', 'APJ-003/004/005');
t('repeated block prefix', 'APJ-001, APJ-003 & APJ-004', 'APJ-001/003/004');
t('two days two venues keeps the days', '16th August: SAC OAT | 5:30 PM onwards 📍 17th August: MAC OAT | 6:00 PM onwards',
    'SAC OAT (16th August) / MAC OAT (17th August)');

// ── kept ──────────────────────────────────────────────────────────────────────────────────────────
t('online', 'Online (Meeting link will be shared soon)', 'Online');
t('a webinar hosted elsewhere is still attendable', 'ONLINE to be organized by BIS Head Quarters New Delhi', 'Online');
t('Students’ Club is a real venue', 'Students’ Club', 'Students’ Club');
t('IIT Roorkee suffix is noise', 'ABN Ground, IIT Roorkee', 'ABN Ground');
t('already clean strings pass through', 'Convocation Hall', 'Convocation Hall');

// ── rejected ──────────────────────────────────────────────────────────────────────────────────────
t('Saharanpur is a different campus', 'Committee room, NTB, IIT Roorkee, Saharanpur Campus', null);
t('New Technology Block is Saharanpur', 'Committee room, New Technology Block, IIT Roorkee, Saharanpur Campus', null);
t('another institute', 'Indian Institute of Science (IISc), Bengaluru', null);
t('off campus in Roorkee town', 'Blood Bank, Civil Hospital, Roorkee', null);
t('the whole campus is not a place', 'IIT Roorkee', null);
t('nor is every campus', 'Respective Campuses', null);
t('a promise is not a place', 'Will be notified later', null);
t('nor is a social-media promise', 'To be announced via Instagram story', null);
t('stray label dragged in by flattening', 'Collection Details:', null);
t('empty input', '', null);

console.log(`\n${pass}/${pass + fail} passed.`);
if (fail) process.exit(1);
