const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

/**
 * A typed change-proposal emitted by the ingestion pipeline — the parser never
 * writes events directly, it proposes mutations that a human publishes via the
 * pre-filled create-event form. Maps cleanly onto the calendar preview→commit engine.
 *
 * mutation_type: CREATE_EVENT | PATCH_TIME | PATCH_VENUE | PATCH_DEADLINE |
 *                CANCEL_EVENT | CREATE_NOTICE | CALENDAR_ENTRY | DISMISS
 */
const EventProposal = sequelize.define('EventProposal', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    ingested_email_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'ingested_email', key: 'id' },
        onDelete: 'SET NULL',
    },
    mutation_type: { type: DataTypes.STRING(24), allowNull: false },
    // for PATCH_*/CANCEL — the existing event this mutates (Phase 7). event.id is INTEGER.
    target_event_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'event', key: 'id' },
        onDelete: 'SET NULL',
    },
    // primary attribution (club / fest / "Institute"); null → resolves to Institute.
    club_id: {
        type: DataTypes.BIGINT,
        allowNull: true,
        references: { model: 'club', key: 'id' },
        onDelete: 'SET NULL',
    },
    payload: { type: DataTypes.JSONB, allowNull: true },   // extracted fields
    evidence: { type: DataTypes.JSONB, allowNull: true },  // per-field confidence + identity evidence
    // proposed | published | dismissed
    state: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'proposed' },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
    tableName: 'event_proposal',
    timestamps: false,
    indexes: [
        { fields: ['club_id'], name: 'idx_event_proposal_club' },
        { fields: ['state'], name: 'idx_event_proposal_state' },
        { fields: ['ingested_email_id'], name: 'idx_event_proposal_email' },
    ],
});

module.exports = EventProposal;
