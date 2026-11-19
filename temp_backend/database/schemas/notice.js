const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

/**
 * A campus notice (no club, no "attend") shown on the Notices tab. Two sections
 * via `priority`. Opportunities (scholarships/registrations) land here too.
 * Many notices' real content is a channel-i link (body is thin).
 */
const Notice = sequelize.define('Notice', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    title: { type: DataTypes.TEXT, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: true },
    // important | general
    priority: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'general' },
    link: { type: DataTypes.TEXT, allowNull: true },
    // APPLY-BY date (fee/registration/scholarship DO carry these) — drives expiry.
    deadline: { type: DataTypes.DATEONLY, allowNull: true },
    // Clock time the deadline closes ("HH:MM" IST), when the email states one ("apply by 21 Aug, 6 PM").
    // NULL = no time given, which means end of day — the feeds render it as an all-day item.
    deadline_time: { type: DataTypes.STRING(5), allowNull: true },
    // When the thing HAPPENS, kept distinct from the apply-by above. A notice can have either, both or
    // neither: "applications close 15 Aug" is a deadline, "library reopens 1 Aug, 10:30 AM" is an event_date.
    event_date: { type: DataTypes.DATEONLY, allowNull: true },
    time_start: { type: DataTypes.STRING(5), allowNull: true },   // "HH:MM" IST
    venue: { type: DataTypes.TEXT, allowNull: true },
    // online | physical | tba | null. Distinguishes "happens on Meet, there is no room" from "physical,
    // room not decided yet" from "the mail never said". `venue` is null for both online-less cases, so
    // this is the only thing that tells them apart — the UI renders each differently.
    venue_mode: { type: DataTypes.STRING(8), allowNull: true },
    // "until further notice" / "applicable from…" → never auto-expire.
    open_ended: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    audience: { type: DataTypes.STRING(24), allowNull: true },   // display-only badge
    // classified kind (scholarship|recruitment|competition|fee|registration|resource|facility|deadline|notice)
    kind: { type: DataTypes.STRING(24), allowNull: true },
    // apply/enter-by-deadline item → surfaced by the "Opportunities" filter
    is_opportunity: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // Run by someone other than IIT Roorkee — an outside competition/programme rather than a campus
    // obligation. Drives the EXTERNAL chip, and is why such items never earn the IMPORTANT band.
    is_external: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // Where `deadline` came from. null = the email stated it (or a human set it); 'calendar' = derived
    // from an academic-calendar entry the notice pointed at. Kept separate so a derived date is never
    // mistaken for one the email actually contained.
    deadline_source: { type: DataTypes.STRING(16), allowNull: true },
    // The club this notice belongs to. Nullable — an office announcement (fee, holiday, library) has
    // no club, which is what this table was originally built for. But 62% of CLUB mail lands here too
    // (recruitment, PoR calls, competitions — anything deadline-shaped), and without this column every
    // one of those was orphaned: reviewed by global admins instead of the club's own, and missing from
    // the club's page. Measured on 50 club emails through the live pipeline.
    club_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'club', key: 'id' },
        onDelete: 'SET NULL',
    },
    source: { type: DataTypes.STRING(120), allowNull: true },    // sender display name
    source_message_id: { type: DataTypes.STRING(255), allowNull: true },
    published_at: { type: DataTypes.DATE, allowNull: true },
    expires_at: { type: DataTypes.DATE, allowNull: true },       // computed archive time
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
    tableName: 'notice',
    timestamps: false,
    indexes: [
        { fields: ['priority'], name: 'idx_notice_priority' },
        { fields: ['published_at'], name: 'idx_notice_published' },
        { fields: ['deadline'], name: 'idx_notice_deadline' },
    ],
});

module.exports = Notice;
