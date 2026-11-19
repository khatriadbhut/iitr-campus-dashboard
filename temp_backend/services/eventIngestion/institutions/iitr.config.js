/**
 * IITR tenant config — every institute-specific rule as DATA, so another campus
 * is a new config, not a code change. Consumed by the eventIngestion pipeline.
 */
module.exports = {
    domain: 'iitr.ac.in',

    // Gate 1 — a mail must be broadcast to one of these to be in scope.
    broadcastLists: [
        'students-notices@iitr.ac.in',
        'ug@iitr.ac.in',
        'pg@iitr.ac.in',
        'ug-1st-year@iitr.ac.in',
        'pg-1st-year@iitr.ac.in',
        'staff-notices@iitr.ac.in',   // used only to detect cross-posts; not a positive signal alone
        'faculty-notices@iitr.ac.in',
    ],

    // Gate 2 — pure governance / PR / noise senders (dropped even on a list).
    // NB: donotreply-acad@ is NOT here — its list notices (registration/calendar) are real;
    //     its OTPs never hit a broadcast list so Gate 1 drops those anyway.
    denySenders: [
        'noreply-emailsupport@iitr.ac.in', 'estba@iitr.ac.in', 'ar.gadm@iitr.ac.in',
        'registrar@iitr.ac.in', 'safetyofficer@iitr.ac.in', 'cmo@iitr.ac.in', 'chac@iitr.ac.in',
        'greenoffice@iitr.ac.in', 'professor.incharge.ranking@iitr.ac.in', 'chair.dinc@iitr.ac.in',
        'director@iitr.ac.in', 'ddirector@iitr.ac.in', 'cvo@iitr.ac.in', 'ceo.tih@iitr.ac.in',
        'sonika.dsric@iitr.ac.in', 'so@security.iitr.ac.in', 'pic.safety@iitr.ac.in',
        'noreply.finance@iitr.ac.in', 'manager.aad@iitr.ac.in', 'liaisonofficerscst@iitr.ac.in',
        'vision2047@iitr.ac.in', 'adinfra.projects@iitr.ac.in', 'fc.timetable@ee.iitr.ac.in',
        'elect.office@iitr.ac.in', 'aradmission@iitr.ac.in',
    ],

    // Gate 2 — SOFT junk subjects (governance/exam-admin/OTP). Overridable by a positive student
    // signal (e.g. a muted office that, for once, sends a holiday/fee/scholarship notice).
    denySubjects: [
        /viva-?voce/i, /open notice for ph\.?\s?d/i, /^\s*om\s*:/i, /office memorandum/i,
        /minutes of .*meeting/i, /quarantined/i, /otp for login/i,
    ],
    // HARD gate deny (checked BEFORE the positive-signal override) — governance ABOUT specific people
    // and commercial promos are never general campus info, so an incidental "fellowship"/keyword in the
    // body must NOT rescue them. Kept out of the PII wall since they aren't personal-data leaks.
    denySubjectsHard: [
        /appointment of\b|have been appointed|\bnodal officer\b|reconstitut(ion|ed)|committee constitut/i,
        /\bdelhivery\b|campus express|shipping (charges|offer)|luggage (transport|shipping)|promo ?code|coupon code|cashback/i,
    ],

    // PRIVACY WALL — personal / individual data that must NEVER surface, even on a broadcast list
    // and even with a positive signal (non-overridable). This is the deterministic fail-safe that
    // holds when Groq is off. Targets marksheets / result lists / named-student lists, not generic
    // "results are out, check the portal" announcements.
    // NB the viva-voce / examination-of-<named-person> / exposed-enrolment-number branches: PhD open
    // viva notices carry a student's name + enrolment number + thesis title and are broadcast to the
    // whole list — they are personal data and must HARD-drop regardless of any positive signal in the
    // body (an end-sem "Examination Schedule" has no "of Mr X" / "Enrolment No. <digits>" so is safe).
    // DROP-FAVOURING by design: a false drop only costs one manual entry; a false pass LEAKS a
    // student's personal data to the public feed. So this wall is broad and non-overridable.
    // Covers: academic performance/standing, personal identifiers/finance, security secrets, and the
    // PhD-viva / examination-of-<named-person> broadcasts described above.
    // NB matches only genuinely PERSONAL data (documents, named lists, exposed IDs, disciplinary/
    // medical, identity/finance, security secrets) — NOT institutional schedules (a broadcast
    // "supplementary exam schedule" or "results declared, check Channel-i" is safe and stays).
    sensitiveContent: new RegExp([
        /(cgpa|sgpa|\bspi\b|\bcpi\b)\s*(of\s+)?[:=]\s*\d/,                          // a PRINTED grade VALUE ("CGPA: 8.4"), NOT a scholarship's "min CGPA"/"no CGPA" eligibility mention
        /grade\s*(card|point|sheet|report)|mark[-\s]?sheet|report card/,             // grade documents
        /provisional (merit|result|selection) list/,
        /list of (defaulters?|debarred|shortlisted|selected|failed) (candidates?|students?)/,  // NAMED lists
        /roll (no|number)s?\.?\s*[:\-]|enroll?ment\s*(no\.?|number)\s*[:.]?\s*\d{4,}/,  // exposed student IDs (both "enrolment"/"enrollment")
        /academic\s+(probation|standing)/,                                           // personal academic status
        /disciplinary action|show[-\s]?cause notice/,
        /condolence|shok sandesh|sad (and untimely )?demise|passed away|(untimely|sudden) (death|demise)/,  // ceremonial, about a named person
        /medical report/,                                                            // NB not "certificate" — that's a process notice, not personal data
        /fee defaulters?|outstanding dues/,
        /viva[-\s]?voce|examination of (mr|ms|mrs|shri|smt|sri|dr)\.?\s+[a-z]/,        // PhD viva PII
        /\baadha?ar\b|\bpan\s*(card|no\.?|number)\b|\bifsc\b/,                         // identity leak (NOT "bank account" — collides with fee-payment instructions)
        /pay[-\s]?slip|salary slip/,
        // A LEAKED OTP VALUE, not the word. "An OTP will be sent to your registered email ID for
        // login" is boilerplate on every AIS/portal notice — as a bare term it dropped the whole
        // Academic Registration notification as sensitive. Requiring an adjacent 4-8 digit run keeps
        // a real leak ("Your OTP is 483920") and lets the instruction through.
        /(one[-\s]?time password|\botp\b)\W{0,16}\d{4,8}\b|\b\d{4,8}\b\W{0,16}(one[-\s]?time password|\botp\b)/,  // NB not bare "password" — every online-talk meeting passcode has it
    ].map((r) => r.source).join('|'), 'i'),

    // Positive student signals — the presence of any one lets a SOFT-denied sender/subject through
    // (holidays, fees, scholarships, exams, events…). Checked AFTER the privacy wall, so it can
    // never rescue personal data.
    // Three CONTENT rescues added after surveying a year of muted-sender mail (201 emails, 144 of them
    // silently dropped). No sender was un-muted — these rescue specific mail whoever sends it:
    //   · an institute FUNCTION — "Celebration of Independence Day Function", "Pledge-Taking Ceremony
    //     on National Unity Day". Requires a celebration word NEXT TO the day name, so the "Happy
    //     Republic Day" greetings the same offices send stay muted.
    //   · a COURSE students can enrol in — the Basic Indian Sign Language batches and the Inclusive
    //     Well-Being course, all previously lost.
    //   · the INSTITUTE HOSPITAL — OPD timings, dental hours, which consultant is in and when. Dull,
    //     but there is nowhere else a student gets it.
    // Measured: rescues 21 of the 144, leaves tenure extensions, committee reconstitutions, beehive
    // removals, meeting minutes and festival greetings exactly where they were.
    positiveSignals: /\b(?:celebration|function|ceremony|observance|pledge[- ]taking|flag hoisting)\b[^.\n]{0,40}\b(?:independence day|republic day|constitution day|national unity day|birth anniversary|earth hour)\b|\b(?:independence day|republic day|constitution day|national unity day|birth anniversary|earth hour)\b[^.\n]{0,40}\b(?:celebration|function|ceremony|observance|pledge)\b|\b(?:course|training programme|certification programme)\b|\b(?:opd|institute hospital|dental)\b|\bconsultant\s+(?:cardiologist|neurosurgeon|pulmonologist|surgeon|urologist|gastro)|holiday|teaching day|academic calendar|(mte|ete|mid-?term|end-?term|exam|re-?exam).*(schedule|date|timetable)|fee\s*(payment|submission|deadline)|last date.*fee|scholarship|fellowship|freeship|financial assistance|last date to apply|apply by|deadline|registration (open|for|deadline|schedule)|\brecruit|\bpors?\b|internship|placement (drive|session)|workshop|hackathon|competition|convocation|guest lecture|seminar|webinar|screening|\bfest\b/i,

    // Spam-filter prefixes to strip — NEVER a deny signal (IITR mislabels real events).
    // Feeds BOTH the displayed title and runner.conversationKey() — which is what dedups a re-send.
    // Only Re:/Fwd:/FW: were stripped, so a resend titled "Reminder: X" hashed differently from "X" and
    // published a SECOND card. Measured over 45 live mails: Puppetry appeared 3x, the Carbon
    // Nanomaterials lecture, the BFSI workshop and the Fee Payment notice twice each — a reminder-shaped
    // subject was the cause every time. `remi?n?der` deliberately also matches the real-world typo
    // "Gentle Remider:". Reminder/repost are repeats BY DEFINITION; a genuine reschedule is caught
    // earlier by detectLifecycle() and is never treated as a duplicate.
    stripSubjectPrefixes: [
        /^\s*\[SUSPECTED SPAM\]\s*/i, /^\s*\[SPAM\]\s*/i, /^\s*(re|fwd|fw)\s*:\s*/i,
        /^\s*(?:(?:gentle|soft|polite|kind|friendly|final|last|urgent|important)\s+)?remi?n?der\s*[:\-]\s*/i,
        /^\s*re-?post(?:ing)?\s*[:\-]\s*/i,
    ],

    // Relay senders — the real org is in the SUBJECT, not the From address.
    // Addresses that broadcast ON BEHALF OF other clubs. Their own address must never be used to
    // attribute — gensec.cult@ is even stored in the club table AS Cultural Council, so matching it
    // would tag every cultural club's mail as Cultural Council. Measured over a year: fa.culsoc@ alone
    // forwards 18 club mails, gensec-sports@ 12, gensec.pgacads@ 31, gensec.ughostel@ 14.
    relaySenders: [
        'gensec.technical@iitr.ac.in', 'gensec.cult@iitr.ac.in', 'fa.culsoc@iitr.ac.in',
        'gensec-sports@iitr.ac.in', 'gensec.pgacads@iitr.ac.in', 'gensec.ughostel@iitr.ac.in',
    ],
    // Club names that are ordinary English, a venue, or a parent body. Blocked from free-text matching
    // because each one was measured producing wrong attributions:
    //   institute  - "National Institute of Mithila Art"        (47 emails)
    //   share      - the verb, vs the club ShARE                (22 emails)
    //   sac        - the SAC *building*, in 27 of 29 mentions
    //   cec        - the Continuing Education Centre *venue*
    //   fine       - "students from fine arts, design, architecture" = a field of study
    clubAliasDenyText: ['institute', 'share', 'sac', 'cec', 'fine', 'design', 'cultural', 'finance',
        'music', 'think', 'green', 'watch', 'audio', 'drama', 'photo', 'vivek', 'chess', 'img'],
    // Umbrella bodies. They ARE clubs and run their own events, but they are named inside other clubs'
    // mail as the parent ("HELIOS is a club under the Students' Technical Council"), so they only count
    // from the subject line or a sign-off — never a passing mention. STC in-subject was 2/2 correct;
    // STC in-body-only was 0/5, and its Instagram link `stc.iitr` sits in 101 forwarder signatures.
    clubUmbrella: ['stc', 'students technical council', 'cultural council'],
    // Short forms clubs actually use for themselves, confirmed by counting occurrences in a year of
    // mail. Only the ones the roster cannot derive on its own are listed — a "SHORT (Long Form)" name
    // already yields its short half, and a trailing "IITR" is already stripped.
    // Deliberately NOT included: auto-derived first words, which measured as junk (Design in 102
    // emails, Cultural 43, Finance 30, Music 27, Watch 14 — nearly all ordinary prose).
    clubAliases: {
        'Himalayan Explorers Club': ['HEC'],
        'Corporate Interaction Group': ['CIG'],
        'Vivekananda Student Circle': ['VSC'],
        'MDG Space': ['MDG'],
        'SPIC MACAY': ['SPIC'],
        'CineSec Cinematics Section IITR': ['CineSec'],
        'Photography Club': ['Photog'],
        'Cognizance': ['Cogni'],
        'Dramatics Section': ['DRAMS'],
        'TEDX ITR': ['TEDX', 'TEDx IITR', 'TEDxIITRoorkee'],
        'BlocSoc IITR': ['BlocSoc'],
        'Esports IITR': ['Esports', 'E-Sports'],
        // DISCOVR signs off "Student Technical Council" — singular, no apostrophe — while the roster
        // says "Students’ Technical Council". Clubs do not spell their own names consistently.
        'STC (Students\u2019 Technical Council)': ['STC', 'Student Technical Council'],
        // the club writes itself FASHSOC; the roster name is the full one
        'Fashion Society': ['FASHSOC'],
    },
    // Extra addresses a club owns beyond the one in its roster row. E-Cell runs E-Summit from a second
    // address (7 mails/yr), STC runs DISCOVR from a third.
    clubExtraAddresses: {
        'fc.esummit@iitr.ac.in': 'E-Cell',
        'discovr@iitr.ac.in': 'STC (Students\u2019 Technical Council)',
    },
    // A sender whose local-part starts institutional (an office/club/dean/head) is "verified"; anything
    // else (e.g. a random rollnumber/personal address) gets an "unverified sender" badge in review so the
    // admin double-checks. Not a drop — just a trust hint; the sender can be added to the map to clear it.
    institutionalSenderCues: /^(head|dean|ad[a-z]{0,3}|gensec|office|coordinator|conven[eo]r|aao|awards|library|librarian|registrar|chair|director|hod|dosw|placement|cdc|tnp|estb|so_|pro_|cwc|warden|proctor|nss|hec|cinemaclub|sports|fitindia|cognizance|thomso|srishti|sangram|cig|guptafcc|fa\.)/i,

    // Co-senders that broadcast the same items → dedup partners.
    coSenderGroups: [
        ['gensec.cult@iitr.ac.in', 'fa.culsoc@iitr.ac.in'],
        ['aao-timetable@iitr.ac.in', 'donotreply-acad@iitr.ac.in'],
    ],

    // CALENDAR DAY-STATUS only: the sole email→academic-calendar writes are day-status changes —
    // holidays and working/teaching days (incl. timetable-reschedule). These colour a day on the grid.
    // NB deliberately NOT here: exam schedules (→ notice, link-only) and "academic calendar" PDF
    // notifications (→ notice; the authoritative calendar is imported from the PDF, not written by email).
    // "re-?scheduling of classes" (NOT bare "rescheduling", which caught company interview-session reschedules)
    calendarDaySubjects: /\bholiday\b|teaching day|non-?teaching day|working day|time-?table\s*(re-?schedul|change)|re-?scheduling of classes|schedule of classes/i,
    // a day-status is a HOLIDAY if it reads holiday/closed; else a WORKING day (incl. timetable swap).
    calendarHolidayCues: /\bholiday\b|closed|closure|remain closed/i,

    // Flat category set (also seeded into event_category).
    categories: [
        'Talks & Lectures', 'Competitions & Hackathons', 'Workshops & Courses',
        'Recruitments & PORs', 'Sports & Fitness', 'Cultural & Fests',
    ],

    // Keyword → category (first match wins; an item may get several).
    // EVERY alternative is \b-anchored. Unanchored substrings silently mis-tagged real events: "drama"
    // fired inside "dramatic", and the same shape gives "cup" in "occupied", "band" in "bandwidth",
    // "match" in "rematch". Plurals are spelled out rather than left to a bare stem.
    // "guest"/"expert"/"address" additionally require their talk context — a bare "guest house",
    // "expert committee" or "email address" is not a lecture.
    categoryRules: [
        // Terms below were added 2026-08-25 after measuring the 90 uncategorised events in a year of
        // mail. EVERY addition was scored as (events it rescues : already-categorised events it also
        // fires on). Anything noisy or with zero gain was rejected rather than added "for completeness":
        //   interactions 6:33 · discussions 2:21 · series 1:15 · theatre 0:15 · plays 0:10 — all dropped.
        //   symposium, panel discussion, meet-up, league, open mic, recital, hike, expedition, safari,
        //   rowing, coordinator, felicitation — 0 gain each, so they buy nothing and can only misfire.
        { cat: 'Competitions & Hackathons', re: /\b(?:hackathons?|competitions?|contests?|challenges?|olympiads?|quiz(?:zes)?|tournaments?|cups?|championships?|case study|ideathons?|treasure hunts?)\b/i },
        { cat: 'Workshops & Courses', re: /\b(?:workshops?|courses?|bootcamps?|masterclass(?:es)?|trainings?|certifications?|webinars?|session on|hands-?on)\b/i },
        { cat: 'Recruitments & PORs', re: /\b(?:recruit(?:ment|ments|ing|s)?|hiring|applications open|call for (?:organizers|volunteers|coordinators)|join the team|por|core team|inductions?|mock interviews?)\b/i },
        // trek 8:1 is the single best-scoring addition in the whole set — HEC runs treks all year and
        // not one of them was categorised. A bare "volunteers" was NOT added (1:3); the existing
        // "call for volunteers" already covers the real recruitment phrasing.
        { cat: 'Sports & Fitness', re: /\b(?:sports?|trials?|marathons?|triathlons?|fitness|match(?:es)?|athletics?|yoga|swimming|cricket|football|badminton|treks?|trekking|chess)\b/i },
        { cat: 'Cultural & Fests', re: /\b(?:pronite|star night|dj night|fashion|cultural|screenings?|movies?|films?|drama|dance|music|kavi sammelan|fests?|nukkad|bands?|garba|exhibitions?|photowalks?|comedy|stand[- ]?up)\b/i },
        // conference/summit/conclave/roundtable are all "people assemble to hear speakers" — the same
        // shape as a seminar, so they belong here rather than in a category of their own. Their
        // collateral (conference 6:13, summit 8:7) is mostly a multi-day event that legitimately earns
        // Talks alongside Workshops, not a misfire. "session by X" is the speaker-led twin of the
        // "session on X" already claimed by Workshops.
        { cat: 'Talks & Lectures', re: /\b(?:lectures?|talks?|seminars?|colloqui(?:um|a)|keynote|endowment|memorial lecture|conferences?|summits?|conclaves?|roundtables?)\b|\b(?:guest|expert)\s+(?:lecture|talk|speaker|session)\b|\b(?:keynote|inaugural|welcome|presidential)\s+address\b|\baddress\s+by\b|\bsession\s+by\b/i },
    ],

    // Attend-intent cues (event) vs act-by-deadline cues (opportunity).
    attendCues: /invite|invited to attend|cordially|join us|screening|will be held|will deliver|is organizing|welcome to attend|be there|attend the|pronite|inaugural/i,
    deadlineCues: /last date|apply by|register by|submit by|deadline|on or before|closes on|closing|register now|applications? (open|close)|registration.*(open|deadline)|apply now/i,
    venueTokens: /venue\s*:|\bat\s+(apj|lhc|lbs|mac|oat|convocation|room|hall|auditorium|ground|block|academic|senate|seminar|amphitheatre|stadium|lab\b)|\bapj\b|\blhc\b|auditorium|convocation hall|\bs\d\b\s*(hall|lecture)|google\s*meet|g[-\s]?meet|\bzoom\b|ms\s*teams|microsoft\s*teams|webex/i,
    // online-venue cues → an online talk/session still has a "place" (Online); populates venue.
    // NOTE: intentionally does NOT match a bare "link below" / "form link" — those are registration/notice
    // links on physical events (very common in the corpus) and were mislabeling real venues as "Online".
    onlineVenueCues: /google\s*meet|g[-\s]?meet|\bzoom\b|ms\s*teams|microsoft\s*teams|webex|online (session|meeting|mode)|virtual (session|meeting|mode)|\bwebinar\b|meeting link|join (the )?meeting link/i,
    // OFFLINE / hybrid override. An online cue is NOT proof the event is online: campus mail routinely
    // announces a room AND a Meet link ("An online meeting link is available below, but we encourage you
    // to join offline" — a real corpus mail that was being labelled Online, which would have sent
    // students to a link instead of the lecture hall). Whenever the mail says it happens in person, the
    // event is physical; the join URL is not lost, it lives in the separate meeting_link field.
    offlineVenueCues: /\boffline\b|\bin[-\s]person\b|physical\s*(?:mode|venue|presence)|\bhybrid\b|both\s+(?:online\s+and\s+offline|modes)/i,
    // venue DEFERRED — a physical event whose room is not decided yet. Distinct from onlineVenueCues
    // (no room will ever exist) and from silence (the mail never mentioned a venue at all). Must NOT
    // match a deferred DATE ("date to be announced") or a deferred link — hence every branch is
    // anchored to a venue/place word. Real corpus phrasings: "Venue: Will be communicated to the
    // registered participants", "Venue: TBA", "the venue will be announced shortly".
    venueTbaCues: /\b(?:venue|location|hall|room)\b[^.\n]{0,40}\b(?:will be (?:communicated|announced|shared|informed|intimated|declared)|to be (?:announced|decided|confirmed|communicated)|is yet to be|tba\b|tbd\b)|\b(?:venue|location)\s*\**\s*[:\-]\s*\**\s*(?:tba|tbd|to be (?:announced|decided|confirmed))\b/i,
    // Money you could get. Only cash-shaped words were listed, so benefit that is real but spelled
    // differently slipped through: "Viva Gaur Memorial Internship AWARD" (₹20,000) and "Professional
    // Development & Innovation AWARDS" (₹50K/₹25K) were left unpinned beside scholarships worth less,
    // and the Text Book Loan Scheme — a semester of free textbooks, i.e. benefit in kind — matched
    // nothing at all. `award` is deliberately bare: on this corpus it only ever appears on items that
    // carry money, and the cost of a false positive is one extra pin, not a wrong date.
    scholarshipCues: /scholarship|fellowship|fee waiver|financial assistance|chhatravrati|yojna|\bawards?\b|\bawardees?\b|\b(?:tbls|text ?book loan)\b/i,

    // ── What earns the pinned "IMPORTANT" band on the Notices tab ────────────────────────────────
    // Measured 2026-08-22: the old rule (every opportunity + any title containing fee/registration/
    // holiday/result/facility/closure/library/exam) pinned 103 of 171 notices — 60%, which makes the
    // band meaningless. It put external hackathons, five near-duplicate NBCS quizzes, "Resumption of
    // EBSD Facility" and a football-field closure above fee payment and academic registration.
    // The test is CONSEQUENCE, not topic: does ignoring this cost the student something by default?
    //   · an administrative action they must take (registration, fees, ID card, exam, result)
    //   · money (scholarship / fee waiver)
    //   · a campus-wide disruption they'd otherwise walk into (holiday, closure, shutdown)
    //   · an IITR club/PoR recruitment — time-boxed, and the reason most students open the app
    // Everything else still SHOWS, it just doesn't pin: external competitions, guest lectures,
    // seminars, lab-equipment notices, surveys, newsletters, platform launches.
    adminActionCues: /\b(academic registration|course (add|drop|addition|deletion|withdrawal)|add\s*\/\s*drop|registration on ais|ais portal|fee payment|fees? (due|payment|deposit)|tuition fee|late fine|id ?card|identity card|examination (schedule|form|datesheet)|exam (schedule|datesheet|timetable)|end term|mid term|result(s)? (declared|announced|published)|convocation|degree|transcript|grade card|hostel (allotment|allocation|vacation|vacat)|mess (bill|charges)|medical insurance|anti[- ]ragging|undertaking|affidavit)\b/i,
    // Deliberately NOT a bare "closure": "Closure of football field for maintenance" is not something
    // every student needs pinned above fee payment. What qualifies is campus-wide or class-affecting.
    disruptionCues: /\b(holidays?\b|institute holiday|will remain closed|remain closed|shut ?down|shutdown|power (cut|outage|shutdown)|water supply|no classes|classes (suspended|cancelled)|timetable (change|revision)|curfew)\b/i,
    // An externally-run programme is an opportunity, not an institute obligation — show, don't pin.
    externalProgramCues: /\b(winter school|summer school|internship programme|fellowship programme|iit (bombay|delhi|kanpur|madras|kharagpur|guwahati|indore|bhu)|nit\b|iisc|organi[sz]ed by (the )?(ministry|department of|national)|national level|inter[- ]university|world ?skills|india ?skills)\b/i,
    // An OPPORTUNITY that is really an outside contest — shown, never pinned.
    externalContestCues: /\b(hackathon|quiz|conclave|essay (writing )?competition|competition|challenge|championship|olympiad|contest|tournament|summit|expo|fest(ival)?\b|webinar|moocs?|nptel)\b/i,
    // ── Is this run by someone other than IIT Roorkee? ───────────────────────────────────────────
    // Calibrated 2026-08-26 against all 38 live notices. Two traps drove the design:
    //   · "MemTechAI INTERNATIONAL Workshop" is hosted AT IIT Roorkee by the Hydrology department.
    //     A bare /international|national/ cue calls it external and is simply wrong.
    //   · "99 Launchpad" is run by TIDES, IITR's OWN incubator, but its form lives on a third-party
    //     host (tides.accubate.app). A bare domain check calls it external and is also wrong.
    // So: an explicit "run/hosted/organised by <IITR>" or an "at IIT Roorkee" venue OVERRIDES the
    // domain, and the domain only speaks when the text says nothing either way.

    // IITR's own web estate. A link here is conclusive: it is our own.
    iitrHosts: /(^|\.)(iitr\.ac\.in|channeli\.in)$/i,
    // Hosts that carry NO signal — anyone can make a Google Form or post to Instagram. Seeing one of
    // these means "fall through to the text", not "internal".
    neutralHosts: /(^|\.)(forms\.gle|docs\.google\.com|drive\.google\.com|google\.com|instagram\.com|youtu\.be|youtube\.com|linkedin\.com|facebook\.com|twitter\.com|x\.com|bit\.ly|tinyurl\.com|amplifyapp\.com|linktr\.ee|whatsapp\.com|chat\.whatsapp\.com)$/i,
    // Positive evidence that IITR itself runs it — beats the domain.
    iitrRunCues: /\b(?:organi[sz]ed|hosted|run|conducted|presented|convened)\s+by\s+[^.]{0,60}?(?:iit\s*roorkee|iitr\b|tides\b|e-?cell\b|sac\b|students?['’]?\s*affairs|dean\b|department of|centre for|institute)|\bat\s+iit\s*roorkee\b|\biit\s*roorkee\s+(?:campus|premises)\b|\b(?:the\s+)?(?:scsp|dosw|academic affairs|students?['’]?\s*affairs|registrar)\s+office\b/i,
    // A named outside institution — "Adamas University", "Anna University". IITR is never written
    // this way in its own mail (it is "IIT Roorkee" or "Indian Institute of Technology Roorkee"), so
    // a "<Name> University" in the text is somebody else's. Excludes "Indian ..." so the institute's
    // own full name never trips it, and requires the capitalised name so "University Townships
    // Initiative" and "the university" do not.
    externalInstitutionCues: /\b(?!Indian\s)[A-Z][a-zA-Z]{2,}\s+(?:University|Polytechnic)\b/,
    // "I am forwarding an invitation FROM Adamas University" — how most outside opportunities reach
    // campus mail. It names the organiser without ever using the words "organised by", which is why
    // the organiser-verb rule alone missed it.
    forwardedFromCues: /\b(?:invitation|invite|opportunity|announcement|circular|programme|program)\s+from\s+(?:the\s+)?([^.,;:\n]{3,60})/i,

    // Positive evidence of an OUTSIDE organiser. Government bodies and other institutes are the two
    // biggest real sources; a named non-IITR employer is handled by externalEmployerCues.
    externalOrgCues: /\b(ministry of|government of india|govt\.? of india|mygov|rashtrapati bhavan|niti aayog|aicte|ugc\b|drdo|isro\b|csir\b|anrf\b|world bank|united nations|unesco)\b|\biit\s*(bombay|delhi|kanpur|madras|kharagpur|guwahati|indore|bhu|hyderabad|gandhinagar)\b|\b(nit|iiit|iisc|iim)\b/i,

    // A recruitment run by an OUTSIDE EMPLOYER is a job ad, not an institute obligation. Without this,
    // "AI Training Expert at Mereden — for IIT Roorkee students" pinned itself above fee payment purely
    // because its kind is `recruitment` and no external-programme cue matched a private company name.
    //
    // Matches "at <Capitalised>" while excluding the institute's own names. Deliberately errs toward
    // NOT pinning: a false positive here only costs a notice its pin — it still appears in the list,
    // with its deadline chip — whereas a false negative puts an outside job ad above a fee deadline.
    // "at <Capitalised>" reads as an employer, but it also matches a PLACE — "Students Exchange
    // Program at UPLB Philippines" is an IITR-run exchange, and this quietly demoted it to an outside
    // job ad. An employer mention is preceded by a job word (programme AT a firm), so require one
    // nearby rather than trusting the capital letter alone.
    // NB no /i flag, deliberately: the trailing [A-Z] is what makes "at <Capitalised>" mean a named
    // employer rather than "at the library". So the job words carry their own case alternatives —
    // adding /i here would match "at roorkee" and undo the whole test.
    externalEmployerCues: /\b(?:[Ii]nternships?|[Ii]ntern|[Aa]nalyst|[Ee]ngineer|[Dd]eveloper|[Tt]rainee|[Rr]ole|[Pp]osition|[Hh]iring|[Rr]ecruit\w*|[Pp]lacement|[Jj]ob)\b[^.]{0,40}\bat\s+(?!IIT|IITR|Indian Institute|the\s|Roorkee\b)[A-Z][\w&.'-]{2,}/,

    // recruitment / positions-of-responsibility = apply-by-deadline OPPORTUNITY, not an "attend" event.
    recruitmentCues: /\brecruit|applications?\s+(are\s+)?(open|invited|now open)|call for (applications|organizers|volunteers|coordinators|nominations)|\bpors?\b|positions? of responsibility|join (the )?(core )?team|now hiring|inviting applications|\bugta\b|teaching assistant|\bta\s+(requirement|position|recruitment)/i,

    // Notice KINDS — ordered, first match wins. Regexes are TIGHT (context-scoped, not bare
    // keywords) so "registration fee" no longer trips Fee, "Aerothon" no longer trips Registration.
    // opportunity:true kinds are the apply/enter-by-deadline ones → surfaced by the "Opportunities" filter.
    noticeKinds: [
        { key: 'scholarship', label: 'Scholarship', cls: 'k-scholarship', opportunity: true,
          re: /scholarship|fellowship|chhatravrati|yojna|fee waiver|financial assistance|stipend|grant[- ]in[- ]aid|freeship/i },
        { key: 'recruitment', label: 'Recruitment', cls: 'k-recruit', opportunity: true,
          re: /\brecruit|\bpors?\b|position of responsibility|call for (organizers|volunteers|coordinators|nominations|applications)|hiring|inductions?|core team|applications?\s+(are\s+)?(open|invited)/i },
        { key: 'competition', label: 'Competition', cls: 'k-comp', opportunity: true,
          re: /hackathon|\bcompetition\b|\bcontest\b|olympiad|ideathon|case (study )?competition|championship|essay writing|\bquiz\b|tournament|call for (papers|abstracts|posters)/i },
        { key: 'fee', label: 'Fee', cls: 'k-fee', opportunity: false,
          re: /fee payment|payment of (the )?fees?\b|semester fees?|institute fees?|tuition fees?|hostel fees?|fees?\s+(payment|submission|dues|are due|deadline)|last date .*fees?/i },
        { key: 'registration', label: 'Registration', cls: 'k-reg', opportunity: false,
          re: /academic registration|course registration|semester registration|registration for (the )?(autumn|spring|monsoon|winter)?\s*semester|\benrol(l)?ments?\b|online registration for/i },
        { key: 'resource', label: 'Resource', cls: 'k-resource', opportunity: false,
          re: /bloomberg|terminal access|\bsubscriptions?\b|e-?resources?|portal access|repository|database access|journal access|access now/i },
        { key: 'facility', label: 'Facility', cls: 'k-facility', opportunity: false,
          re: /\bclosure\b|closed for|under maintenance|swimming pool|football field|revised .*(slot|timing)|slots? and timings?|hours? of operation/i },
    ],

    // Event-ish cues that, when they land in a NOTICE, signal a likely leaked event → send to the
    // Groq reviewer to decide event-vs-notice (talks/masterclasses/webinars with no parseable venue).
    leakedEventCues: /invited talk|guest lecture|\bseminar\b|colloquium|masterclass|master class|\bwebinar\b|keynote|fireside chat|panel discussion|screening|workshop\b/i,

    // Imperative "come to this" verbs — trigger (d) fires only when one of these AND `attendCues`
    // AND an event category all match, so a passive "all students are welcome" doesn't trip it.
    imperativeAttendVerbs: /\b(join|attend|participate|register to attend|be present|are (cordially )?invited)\b/i,

    // Lifecycle cues — a follow-up that CHANGES a prior item, not a fresh announcement. cancel →
    // CANCEL_EVENT, reschedule/change → PATCH_EVENT (a plain "Reminder"/"Re:" is NOT a change → deduped).
    lifecycleCancelCues: /\b(cancell?ed|called off|stands cancelled|has been withdrawn|postponed indefinitely|will not (be held|take place))\b/i,
    // NB deliberately NOT "deadline/last-date extended" — a moved deadline is an OPPORTUNITY update
    // (re-published with the new date), not a club-event reschedule; those were flooding PATCH_EVENT.
    lifecyclePatchCues: /\b(postponed to|postponement|prepon(ed|ement)|reschedul(ed|ing|e)|revised (date|time|timing|schedule|venue)|change (in|of) (date|time|timing|venue|schedule)|new (date|time|timing|venue)|(venue|timing|date|time) (has )?(been )?changed)\b/i,
    // DEADLINE EXTENSION — a follow-up that moves an apply-by date on an EXISTING notice, not a fresh
    // announcement and not an event reschedule. Previously these were excluded from lifecyclePatchCues
    // (they were flooding PATCH_EVENT) but nothing else handled them, so an extension mail either got
    // swallowed by the 21-day subject dedup (same subject → "duplicate", new date lost) or published a
    // second competing notice. It now gets its own PATCH_NOTICE mutation, applied to the live notice.
    // Anchored to a deadline word so a rescheduled EVENT does not match.
    deadlineExtendCues: /\b(?:last date|deadline|due date|registration|application[s]?|submission)\b[^.\n]{0,60}\b(?:extended|extension|has been extended|now (?:extended|open till|open until))\b|\b(?:extension|extended)\b[^.\n]{0,40}\b(?:last date|deadline|due date|registration|application[s]?|submission)\b/i,
    // OPEN-ENDED POSTPONEMENT — "postponed for now", "postponed until further notice", "put on hold".
    // Checked only AFTER lifecyclePatchCues, so "postponed TO 5 September" (which names a replacement
    // date) still routes to PATCH_EVENT. What is left here is a mail that says the item is NOT
    // happening as announced and does NOT say when it will be instead.
    //
    // Why this is a CANCEL and not a PATCH: a patch needs a value to patch WITH. Every other cue in
    // lifecyclePatchCues carries a replacement ("revised date", "new venue", "postponed to X"). This
    // one carries nothing, so there is no date to write — the only honest action is to take the item
    // off the feed and wait for the re-announcement.
    //
    // This gap was real: CDC's "sessions ... have been postponed for now" (28 Aug 2026) matched
    // NEITHER cancel nor patch, so the cancellation reached the review queue dressed as a fresh
    // CREATE_NOTICE with the same title as the already-published announcement — indistinguishable
    // from a duplicate, and duly dismissed. The sessions stayed on the feed.
    // Deliberately NOT including "deferred": in institute mail it attaches to admissions and fee
    // deferment far more often than to events.
    lifecyclePostponeCues: /\b(postpon(ed|ing|ement)|put on hold|kept on hold|held in abeyance)\b/i,
    // The subset of lifecyclePatchCues that moves a DATE/TIME, as opposed to a venue. Only these are
    // eligible for the "no new value stated → it's really an open-ended postponement" downgrade in
    // runPipeline. A venue change is excluded on purpose: venue extraction is far weaker than date
    // extraction ("the venue has been changed to the Convocation Hall" parses to null today), so
    // downgrading on a missing venue would turn real venue changes into cancellations.
    lifecycleTimeShiftCues: /\b(postpon(ed|ing|ement)|prepon(ed|ement)|reschedul(ed|ing|e)|revised (date|time|timing|schedule)|change (in|of) (date|time|timing|schedule)|new (date|time|timing)|(timing|date|time) (has )?(been )?changed)\b/i,

    // INSTITUTE OFFICES & PROGRAMMES that live in the `club` table because it is the only place to
    // record an organiser — they are NOT student clubs. Matched on the club NAME as stored.
    // Consequence: the "a club running its own thing is an EVENT" rule does NOT apply to these. Only
    // a genuine event from them (a real date and place) reaches the events feed; their recruitment,
    // circulars and programme announcements stay notices.
    // NB "E-Cell" is deliberately absent — despite the name it is a student club, not an office.
    // The three student COUNCILS are treated as offices: their own mail is administrative, and the
    // club activity they relay is attributed to the club named in the subject, not to the council.
    instituteEntities: [
        'Institute',
        'CDC (Career Development Cell)',
        'PIC(Placement and Internship Cell)',
        'Fit India',
        'Green Office',
        'Outreach Cell',
        'IR Cell',
        'Hindi Cell',
        'SAC(Student Affairs Council)',
        'STC (Students\u2019 Technical Council)',
        'Cultural Council',
    ],

    // EXTERNALLY-ORGANISED competition/hackathon/fellowship, merely CIRCULATED by a campus club.
    // A club's OWN hackathon/competition/recruitment is something you turn up to on campus — an EVENT.
    // The same club forwarding somebody else's national contest is just passing on information — a
    // NOTICE. The discriminator is who runs it: another institute, a company, a ministry, or a
    // nationwide/inter-university scope, and entry via an external contest portal.
    externalOrganiserCues: new RegExp([
        // another institute / university runs it (IIT Roorkee itself must NOT match)
        /\b(?:organi[sz]ed|hosted|conducted|presented)\s+by\s+(?!.{0,20}\bIIT\s*Roorkee)/.source,
        /\bIIT\s*(?:Bombay|Delhi|Madras|Kanpur|Kharagpur|Indore|Guwahati|Hyderabad|BHU|Mandi|Gandhinagar)\b/.source,
        /\b(?:IIIT|NIT|BITS|IISc|IIM)\b|\bIITRAM\b|\binter[-\s]?university\b/.source,
        // national / all-India scope — never a single campus club's own event
        /\bnational(?:wide)?\s+(?:level\s+)?(?:hackathon|challenge|competition|championship|conclave|contest|programme|program)\b/.source,
        /\ball[-\s]india\b|\bindia'?s\s+largest\b|\bglobal\b.{0,20}\b(?:challenge|competition|contest)\b/.source,
        // an external company / ministry / body is the sponsor-organiser
        /\b(?:HAL|CMPDI|E\.?ON|InMobi|Deloitte|Ministry of|Embassy of|DRDO|ISRO|MyGov)\b/.source,
        // entry runs through an external contest portal
        /\b(?:unstop\.com|dare2compete|mygov\.in|hackerearth|devfolio)\b/.source,
    ].join('|'), 'i'),

    // Attend-FORMAT cues — an opportunity intent (recruitment / scholarship / fellowship) is an EVENT
    // only when the mail is explicitly one of these gatherings you show up to. "Recruitment TALK" =
    // event; "Recruitment announcement / drive / applications open" = notice. (Note: "drive" is NOT
    // here — a recruitment drive is an apply-announcement, not an attend-event.)
    // "session" excludes an academic session ("session 2026-27") via a no-following-year lookahead.
    attendFormatCues: /\btalk\b|\bsession\b(?!\s*\d)|orientation|presentation|seminar|colloquium|briefing|interaction|\bintro\b|info[-\s]?session|screening|audition|\binterview|walk[-\s]?in|open house|ceremony|felicitation|valedictory|inaugural|bootcamp|workshop|meet[-\s]?up|\bexpo\b|exhibition|\btest\b/i,
};
