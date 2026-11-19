/**
 * Idempotent seed for Feature #2 (email ingestion): the flat category set, the
 * known fests + "Institute" catch-all as club rows, and the initial homogeneous
 * sender→club map. Safe to run every boot (findOrCreate); mirrors seedAcademicCalendar.
 */
const { EventCategory, Club, SenderEntityMap } = require('./schemas');

const CATEGORIES = [
    'Talks & Lectures',
    'Competitions & Hackathons',
    'Workshops & Courses',
    'Recruitments & PORs',
    'Sports & Fitness',
    'Cultural & Fests',
];

// club rows: catch-all + the 4 known fests + known content-homogeneous clubs.
// club.email is NOT NULL + unique — use the real list address.
const CLUBS = [
    { name: 'Institute', email: 'institute@iitr.ac.in', is_fest: false, description: 'Official / institutional events not tied to a single club.' },
    { name: 'Cognizance', email: 'cognizance@iitr.ac.in', is_fest: true, description: 'Annual technical fest.' },
    { name: 'Srishti', email: 'srishti@iitr.ac.in', is_fest: true, description: 'Annual technical exhibition.' },
    { name: 'Thomso', email: 'thomso@iitr.ac.in', is_fest: true, description: 'Annual cultural fest.' },
    { name: 'Sangram', email: 'sangram@iitr.ac.in', is_fest: true, description: 'Annual sports fest.' },
    { name: 'Himalayan Explorers Club', email: 'hec@iitr.ac.in', is_fest: false, description: 'Treks and outdoor adventures.' },
    { name: 'Cinema Club', email: 'cinemaclub@iitr.ac.in', is_fest: false, description: 'Film screenings.' },
];

// sender / subject-pattern -> club (homogeneous senders + fest addresses only).
const SENDER_MAP = [
    { match_value: 'hec@iitr.ac.in', club: 'Himalayan Explorers Club' },
    { match_value: 'cinemaclub@iitr.ac.in', club: 'Cinema Club' },
    { match_value: 'cognizance@iitr.ac.in', club: 'Cognizance' },
    { match_value: 'fa.cognizance@iitr.ac.in', club: 'Cognizance' },
    { match_value: 'thomso@iitr.ac.in', club: 'Thomso' },
    { match_value: 'fa.thomso@iitr.ac.in', club: 'Thomso' },
    { match_value: 'sangram@iitr.ac.in', club: 'Sangram' },
];

async function seedEventIngestion() {
    // Categories
    for (const name of CATEGORIES) {
        try { await EventCategory.findOrCreate({ where: { name }, defaults: { name } }); }
        catch (e) { console.error(`seed category "${name}" failed:`, e.message); }
    }

    // Clubs (fests + Institute + known homogeneous)
    const clubIdByName = {};
    for (const c of CLUBS) {
        try {
            const [row] = await Club.findOrCreate({ where: { name: c.name }, defaults: c });
            if (row.is_fest !== c.is_fest) { row.is_fest = c.is_fest; await row.save(); }
            clubIdByName[c.name] = row.id;
        } catch (e) { console.error(`seed club "${c.name}" failed:`, e.message); }
    }

    // Sender → club map
    for (const m of SENDER_MAP) {
        const club_id = clubIdByName[m.club];
        if (!club_id) continue;
        try {
            await SenderEntityMap.findOrCreate({
                where: { match_value: m.match_value },
                defaults: { match_type: 'sender', match_value: m.match_value, club_id },
            });
        } catch (e) { console.error(`seed sender-map "${m.match_value}" failed:`, e.message); }
    }
}

module.exports = seedEventIngestion;
