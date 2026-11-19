const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

/**
 * A delivered notification. This table does three jobs at once:
 *
 *   1. It IS the in-app notification centre (/notifications reads it).
 *   2. It is the dedup ledger — see dedup_key. Without it a restart or a re-poll would re-notify
 *      everything, the same failure the ingestion pipeline solved with its own state row.
 *   3. It is the push queue: pushed_at IS NULL means "not yet delivered to a device" (Phase 2).
 *
 * Rows are written by the generator worker, never by a request handler, so a user can never cause
 * one to exist for someone else.
 */
const Notification = sequelize.define('Notification', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },

    user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'user', key: 'user_id' },
        onDelete: 'CASCADE',
    },

    // mine | feed | review — which of the three channels produced this, so the centre can group and
    // so a preference change can suppress a channel without touching the others.
    channel: { type: DataTypes.STRING(8), allowNull: false },

    // todo | reminder | event | notice | review
    type: { type: DataTypes.STRING(16), allowNull: false },

    /**
     * The idempotency key, unique per user. One column rather than a (type, target_id) pair because
     * the cases do not share a shape:
     *
     *   todo:412            one per todo
     *   reminder:88:30      per event AND offset — 30-min and 5-min reminders are different rows
     *   event:1204          one per published event
     *   notice:57           one per published notice
     *   review:2026-08-31T08:10   a COALESCED batch, keyed on its 10-minute window
     *
     * That last one is why this is a string and not a foreign key. A backfill created 38 proposals
     * in 9 minutes on 2026-08-26; one push each would have been 38 buzzes for two admins. Keying the
     * batch on its window collapses them into a single "6 new items to review".
     */
    dedup_key: { type: DataTypes.STRING(80), allowNull: false },

    // Where tapping it goes, as an in-app path (e.g. /app/event/1204). Nullable for the rare
    // notification with nothing to open.
    url: { type: DataTypes.TEXT, allowNull: true },

    title: { type: DataTypes.TEXT, allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: true },

    // How many items a coalesced row stands for (1 for everything else). Lets the centre render
    // "6 new items to review" without a second query.
    item_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },

    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    read_at: { type: DataTypes.DATE, allowNull: true },
    // Set once a web-push send has been attempted for this row (Phase 2). NULL = still queued.
    pushed_at: { type: DataTypes.DATE, allowNull: true },
}, {
    tableName: 'notification',
    timestamps: false,
    indexes: [
        // The dedup guarantee. Insert is done with ignoreDuplicates, so a second attempt at the same
        // notification is a no-op rather than an error — the worker can re-run a tick safely.
        { unique: true, fields: ['user_id', 'dedup_key'], name: 'notification_user_dedup' },
        // The centre's read: newest first for one user.
        { fields: ['user_id', 'created_at'], name: 'notification_user_created' },
        // The push queue drain (Phase 2): everything not yet sent.
        { fields: ['pushed_at'], name: 'notification_pushed_at' },
    ],
});

module.exports = Notification;
