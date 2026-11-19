const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

/**
 * Super-admin-taught classification override: a scoped, deterministic rule that forces a
 * (sender [+ optional subject pattern]) → type decision, applied at the reviewProposals seam
 * BEFORE Groq. Scoped by construction — it only ever runs on proposals that already exist, so a
 * PII/governance-gate-dropped email (which never becomes a proposal) is structurally unreachable.
 * A pattern is REQUIRED for relay senders (gensec.technical@ etc.) so a rule can't blanket many clubs.
 * NB: no "dismiss" target in v1 (that's a hard drop; deferred — use soft denies in config instead).
 */
const ClassificationOverride = sequelize.define('ClassificationOverride', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    sender_addr: { type: DataTypes.TEXT, allowNull: false },                 // exact from-address, lowercased
    subject_pattern: { type: DataTypes.TEXT, allowNull: true },              // case-insensitive substring; null = all mail from sender
    target_type: { type: DataTypes.STRING(16), allowNull: false },          // event | opportunity | notice | calendar
    created_by: { type: DataTypes.BIGINT, allowNull: true },                // super-admin user_id
    hit_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    last_hit_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
    tableName: 'classification_override',
    timestamps: false,
    indexes: [{ fields: ['sender_addr'], name: 'idx_clsoverride_sender' }],
});

module.exports = ClassificationOverride;
