//             CONSTRAINT no_overlapping_events_at_location 
//             EXCLUDE USING gist (
//                 location_id WITH =,
//                 tsrange(
//                     tentative_start_time, 
//                     tentative_start_time + make_interval(mins => duration_minutes)
//                 ) WITH &&
//             ) WHERE (location_id IS NOT NULL)
const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

const Event = sequelize.define('Event', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    name: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    club_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'club', key: 'id' },
        onDelete: 'CASCADE',
    },
    location_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'location', key: 'id' },
        onDelete: 'SET NULL',
    },
    tentative_start_time: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    duration_minutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
    },
    actual_start_time: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    image_url: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    is_all_day: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    // ── email-ingestion columns (Feature #2) ──────────────────────────────────
    source: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'manual' },   // manual | email
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'scheduled' }, // scheduled|updated|cancelled|rescheduled|completed
    source_sender: { type: DataTypes.TEXT, allowNull: true },
    source_message_id: { type: DataTypes.STRING(255), allowNull: true },
    registration_link: { type: DataTypes.TEXT, allowNull: true },
    registration_deadline: { type: DataTypes.DATEONLY, allowNull: true },   // "register by" date, distinct from start
    audience: { type: DataTypes.STRING(24), allowNull: true },   // display-only badge
    venue_text: { type: DataTypes.TEXT, allowNull: true },       // freeform venue for ingested events (no curated Location row)
    // online | physical | tba | null — see notice.venue_mode. An ONLINE event has no room and never
    // will; a TBA event has one that is not decided yet. Both leave venue_text null, so without this
    // column the feed cannot tell "Online" from "Venue to be announced".
    venue_mode: { type: DataTypes.STRING(8), allowNull: true },
}, {
    tableName: 'event',
    timestamps: false,
});

module.exports = Event;

// const createEventTable = async (sql) => {
//     // Enable btree_gist extension for exclusion constraints
//     await sql`CREATE EXTENSION IF NOT EXISTS btree_gist;`;

//     await sql`
//         CREATE TABLE IF NOT EXISTS event (
//             id SERIAL PRIMARY KEY,
//             name TEXT NOT NULL,
//             club_id BIGINT NOT NULL REFERENCES club(id) ON DELETE CASCADE,
//             location_id INTEGER REFERENCES location(id) ON DELETE SET NULL,
//             tentative_start_time TIMESTAMP NOT NULL,
//             duration_minutes INTEGER NOT NULL,
//             actual_start_time TIMESTAMP,
//             description TEXT,
//             CONSTRAINT no_overlapping_events_at_location 
//             EXCLUDE USING gist (
//                 location_id WITH =,
//                 tsrange(
//                     tentative_start_time, 
//                     tentative_start_time + make_interval(mins => duration_minutes)
//                 ) WITH &&
//             ) WHERE (location_id IS NOT NULL)
//         );
//     `;
// };

// module.exports = createEventTable;
