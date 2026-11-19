const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

/**
 * Raw normalized email persisted for the "Inbox Replay" net: keep enough to
 * re-run the pipeline when the parser improves, replay a bug-reported message,
 * and regression-test against a saved corpus. One row per Gmail message.
 */
const IngestedEmail = sequelize.define('IngestedEmail', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    message_id: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    thread_id: { type: DataTypes.STRING(255), allowNull: true },
    // Gmail internalDate — authoritative for mutation ordering (never trust body dates).
    internal_date: { type: DataTypes.DATE, allowNull: true },
    from_addr: { type: DataTypes.TEXT, allowNull: true },
    to_addrs: { type: DataTypes.TEXT, allowNull: true },
    subject: { type: DataTypes.TEXT, allowNull: true },
    body_text: { type: DataTypes.TEXT, allowNull: true },
    raw_snapshot: { type: DataTypes.JSONB, allowNull: true },
    // received | parsed | error | dead_letter | dismissed | duplicate
    state: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'parsed' },
    error: { type: DataTypes.TEXT, allowNull: true },
    // normalized-subject signature for content de-dup (co-sender / Fwd / reminder copies)
    dedup_key: { type: DataTypes.STRING(255), allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
    tableName: 'ingested_email',
    timestamps: false,
    indexes: [
        { unique: true, fields: ['message_id'], name: 'idx_ingested_email_msgid' },
        { fields: ['internal_date'], name: 'idx_ingested_email_date' },
        // NB: dedup_key index is created via ALTER in initializeSchema (the column is added there too),
        // NOT declared here — else sync() would try to index a not-yet-existing column and abort init.
    ],
});

module.exports = IngestedEmail;
