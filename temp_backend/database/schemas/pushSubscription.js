const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

/**
 * One row per BROWSER/DEVICE a user has allowed notifications on.
 *
 * Preferences (user_notification_pref) are per ACCOUNT and answer "what am I told about". This is
 * per DEVICE and answers "does THIS screen buzz" — a student muting their laptop must not go silent
 * on their phone, so the two are deliberately separate tables.
 *
 * `endpoint` is the push service's URL for this device and is the natural unique key: browsers rotate
 * it, and the same device re-subscribing must UPDATE rather than accumulate rows. Without the unique
 * constraint this table grows a dead row every time a subscription is refreshed, and every one of
 * them gets sent to forever.
 *
 * p256dh and auth are the client's public encryption keys. The payload is encrypted to them by
 * web-push, so the push service itself cannot read the notification.
 */
const PushSubscription = sequelize.define('PushSubscription', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },

    user_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        references: { model: 'user', key: 'user_id' },
        onDelete: 'CASCADE',
    },

    endpoint: { type: DataTypes.TEXT, allowNull: false },
    p256dh: { type: DataTypes.TEXT, allowNull: false },
    auth: { type: DataTypes.TEXT, allowNull: false },

    // Shown in a future "your devices" list so a student can tell their phone from their laptop.
    // Never used for anything behavioural — UA sniffing is a bad basis for decisions.
    user_agent: { type: DataTypes.TEXT, allowNull: true },

    // The per-device switch. Kept as a flag rather than deleting the row, so turning notifications
    // back on does not require going through the browser permission flow again.
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },

    /**
     * Consecutive send failures that were NOT a definitive 404/410.
     *
     * A 404/410 means the subscription is gone and the row is deleted immediately. Anything else —
     * a timeout, a 500 from the push service — might be transient, so it is counted instead. A row
     * that keeps failing is eventually retired rather than being retried forever on every tick.
     */
    failure_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    last_seen_at: { type: DataTypes.DATE, allowNull: true },
}, {
    tableName: 'push_subscription',
    timestamps: false,
    indexes: [
        { unique: true, fields: ['endpoint'], name: 'push_subscription_endpoint' },
        { fields: ['user_id'], name: 'push_subscription_user' },
    ],
});

module.exports = PushSubscription;
