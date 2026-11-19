const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

/**
 * One row per calendar upload — the audit/version trail that powers rollback.
 * `parsed_snapshot` holds the full committed entry set so a bad import can be
 * reverted without the original PDF (we intentionally do NOT store raw PDF bytes).
 */
const AcademicCalendarImport = sequelize.define('AcademicCalendarImport', {
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
    },
    institution: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'IITR' },
    semester: { type: DataTypes.STRING(48), allowNull: false },
    program: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'general' },
    // committed | superseded | failed
    status: { type: DataTypes.STRING(16), allowNull: false },
    strategy: { type: DataTypes.STRING(48), allowNull: true },
    uploaded_by: { type: DataTypes.BIGINT, allowNull: true, defaultValue: null },
    source_filename: { type: DataTypes.TEXT, allowNull: true },
    // Full { entries } snapshot of what was committed — used to roll back.
    parsed_snapshot: { type: DataTypes.JSONB, allowNull: false },
    coverage: { type: DataTypes.JSONB, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
    tableName: 'academic_calendar_import',
    timestamps: false,
    indexes: [
        { fields: ['institution', 'semester', 'program'], name: 'idx_acal_import_key' },
    ],
});

module.exports = AcademicCalendarImport;
