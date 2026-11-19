const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

/**
 * Structured, admin-taught mapping of a sender (or subject pattern) → a club/fest,
 * so attribution isn't a regex buried in code. Only content-HOMOGENEOUS senders +
 * fests get rows; mixed senders intentionally have none → fall through to "Institute".
 * Self-extending: an admin one-click promotes an unknown sender here.
 */
const SenderEntityMap = sequelize.define('SenderEntityMap', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    // sender | subject_pattern
    match_type: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'sender' },
    match_value: { type: DataTypes.TEXT, allowNull: false },
    club_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'club', key: 'id' },
        onDelete: 'SET NULL',
    },
    created_by: { type: DataTypes.BIGINT, allowNull: true },   // admin user_id
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
    tableName: 'sender_entity_map',
    timestamps: false,
    indexes: [
        { fields: ['match_value'], name: 'idx_sender_map_value' },
    ],
});

module.exports = SenderEntityMap;
