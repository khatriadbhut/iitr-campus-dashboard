const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

/**
 * The served academic-calendar rows. Superset of the public shape: the GET route
 * maps these to the exact legacy `{id,title,category,startDate,endDate,description,
 * isHoliday}` and drops the internal columns.
 *
 * Dates are DATEONLY (same tz-safe pattern as user_todo.due_date) — 'YYYY-MM-DD'
 * with no timezone conversion. Nullable because a genuinely-undecided ("TBD")
 * date stays null until an admin sets it in the preview.
 */
const AcademicCalendarEntry = sequelize.define('AcademicCalendarEntry', {
    // deterministic string id: `${idPrefix}-${slug(title)}-${startDate}-${sortOrder}`
    id: { type: DataTypes.STRING(160), primaryKey: true, allowNull: false },
    institution: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'IITR' },
    semester: { type: DataTypes.STRING(48), allowNull: false },
    program: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'general' },
    title: { type: DataTypes.TEXT, allowNull: false },
    category: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'Academic' },
    start_date: { type: DataTypes.DATEONLY, allowNull: true },
    end_date: { type: DataTypes.DATEONLY, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    is_holiday: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // pdf = authoritative (from an import) | email = amended/added from an ingested email. Email rows
    // survive a PDF re-import (see store.commitCalendar) so live email edits aren't reverted.
    source: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'pdf' },
    tentative: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    raw_date_text: { type: DataTypes.TEXT, allowNull: true },
    source_import_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'academic_calendar_import', key: 'id' },
        onDelete: 'SET NULL',
    },
    sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
    tableName: 'academic_calendar_entry',
    timestamps: false,
    indexes: [
        { fields: ['institution', 'semester', 'program'], name: 'idx_acal_entry_key' },
        { fields: ['start_date'], name: 'idx_acal_entry_start' },
    ],
});

module.exports = AcademicCalendarEntry;
