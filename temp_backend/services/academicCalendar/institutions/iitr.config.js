/**
 * Per-institution config for IIT Roorkee. A future college = a new config like
 * this (+ a new strategy only if its table layout differs). The strategy and
 * pipeline read everything institution-specific from here.
 */
module.exports = {
    institution: 'IITR',
    program: 'general', // this config handles the non-MBA / general (UG) calendar
    idPrefix: 'iitr',

    // ── Deterministic document fingerprints (three-way classifier) ──
    // "Is this an IITR academic calendar at all?"
    calendarMarkers: [
        /ACADEMIC\s+CALENDAR/i,
        /INDIAN\s+INSTITUTE\s+OF\s+TECHNOLOGY\s+ROORKEE/i,
    ],
    // Distinguishes the supported (general) vs unsupported (MBA) IITR calendar.
    generalMarkers: [/Other\s+than\s+MBA/i, /For\s+All\s+Programs?/i],
    mbaMarkers: [/For\s+MBA/i, /MBA\s+Term/i],
    // The main table's column header — strong structural signal of the general layout.
    structureMarkers: [/S\.?\s*N(?:o)?\.?\s+Details/i],

    // ── Semester / program extraction from the header ──
    semesterPattern: /ACADEMIC\s+CALENDAR\s*\(?\s*(AUTUMN|SPRING)\s+SEMESTER\s+(\d{4}\s*-\s*\d{2})/i,

    // ── Sanity checks (SOFT warnings, not hard blocks) ──
    sanity: {
        // Total = main table (~30-35) + holidays (~8-11) + reschedule (~3-9).
        minRows: 25,
        maxRows: 60,
        // The parse almost certainly misread structure if these are absent.
        requiredAnchors: [
            { label: 'Commencement of Classes', pattern: /Commencement\s+of\s+[Cc]lasses/ },
            { label: 'End Term Examinations', pattern: /End\s+Term\s+Examinations/i },
        ],
    },

    // ── Category inference (the PDF has no category column) ──
    // Ordered; first match wins. Anything unmatched → 'Academic' (+ logged).
    categoryRules: [
        { category: 'Timetable Reschedule', match: /time[-\s]?table|reschedul|compensatory/i },
        { category: 'Academic', match: /\bbreak\b|vacation/i }, // "Mid Term Break" is NOT an exam
        { category: 'Exam', match: /re-?\s*examination|examinations?|\bMTE\b|\bETE\b/i },
        { category: 'Fest', match: /cognizance|thomso|sangram|convocation|foundation\s+day|national\s+science\s+day|research\s+day/i },
    ],

    // Valid category set (whitelist — also used to validate any Groq suggestion).
    categories: ['Academic', 'Exam', 'Holiday', 'Fest', 'Timetable Reschedule'],
};
