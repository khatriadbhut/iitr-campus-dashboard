const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

/**
 * Per-ACCOUNT notification preferences. One row per user, created lazily on first read so a student
 * who never opens settings still has working defaults (see routes/notification.js).
 *
 * Deliberately NOT per-device: a student muting things on their laptop must not go silent on their
 * phone. The per-device switch is `enabled` on push_subscription (Phase 2) — that one is about
 * "notify me on THIS screen", this one is about "notify me about THIS kind of thing".
 *
 * Columns are typed rather than a JSONB blob because the delivery worker has to answer "which users
 * want this event?" as a join against muted clubs — clean SQL with columns, awkward with JSON.
 */
const UserNotificationPref = sequelize.define('UserNotificationPref', {
    user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        primaryKey: true,
        references: { model: 'user', key: 'user_id' },
        onDelete: 'CASCADE',
    },

    // ── Channel 1: my things ──────────────────────────────────────────────────
    // Fires at the todo's own due_time — no lead time, by product decision.
    todos: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // Events/notices the user explicitly belled. Opt-in by definition, so on by default.
    saved_items: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

    // ── Channel 2: campus feed ────────────────────────────────────────────────
    // Everything newly published EXCEPT clubs the user has muted. Note there is no "clubs I follow"
    // whitelist in this app: only the notPreferredClub (mute) half was ever implemented — see the
    // note at src/pages/Home.jsx:354. So this is an everything-minus-mutes channel, and the UI says so.
    campus_feed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // off | important | all. STRING rather than ENUM: a Postgres enum needs a type migration to add
    // a value, and every other status column here (notice.kind, proposal.state) is a plain STRING.
    campus_notices: { type: DataTypes.STRING(12), allowNull: false, defaultValue: 'important' },

    // ── Channel 3: review queue (admins only) ─────────────────────────────────
    // Routed by reviewScope(): club admins get their clubs, super admins get everything. Deliberately
    // INDEPENDENT of the feed settings above — an admin who mutes their own club in the feed still
    // has to review its proposals. Ignored entirely for users with no review scope.
    review_queue: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
    tableName: 'user_notification_pref',
    timestamps: false,
});

module.exports = UserNotificationPref;
