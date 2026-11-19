const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

/** Small key/value store for the ingestion runner (Gmail historyId cursor, last-sync). */
const IngestionState = sequelize.define('IngestionState', {
    key: { type: DataTypes.STRING(64), primaryKey: true },
    value: { type: DataTypes.TEXT, allowNull: true },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
    tableName: 'ingestion_state',
    timestamps: false,
});

module.exports = IngestionState;
