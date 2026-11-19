const { DataTypes } = require('sequelize');
const sequelize = require('../connection');

/**
 * An append-only record of every privilege change — who granted or revoked what, to whom, when.
 *
 * WHY: granting admin is rare, high-impact and hard to notice. There was previously no trace of it at
 * all: someone gaining admin looked identical to someone who always had it. With a handful of admins,
 * DETECTION beats prevention — an unexpected "X granted admin to Y" alert is instantly recognisable as
 * wrong, and this table is what lets you unwind it. Chosen over a re-authentication prompt on
 * privileged writes, which costs a whole sudo-mode feature and pushes admins toward keeping a session
 * permanently open (worse than no check at all).
 *
 * Never updated or deleted by application code. If a row is wrong, the fix is another row.
 */
const PrivilegeAudit = sequelize.define('PrivilegeAudit', {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    // grant_admin | revoke_admin | update_admin | grant_club_admin | revoke_club_admin
    action: { type: DataTypes.STRING(32), allowNull: false },
    actor_user_id: { type: DataTypes.BIGINT, allowNull: true },      // who did it (null only if unattributable)
    target_user_id: { type: DataTypes.BIGINT, allowNull: true },     // who it was done to
    // what changed: permission ids for institute admins, club id + name for club admins
    detail: { type: DataTypes.JSONB, allowNull: true },
    ip: { type: DataTypes.STRING(64), allowNull: true },
    /**
     * 'urgent' | 'routine' | null. Null for ordinary activity (a publish is neither).
     * Set when the row is written, not when it is read — see recordSecurityEvent for why.
     */
    severity: { type: DataTypes.STRING(16), allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
    tableName: 'privilege_audit',
    timestamps: false,
    indexes: [
        { fields: ['created_at'], name: 'idx_privilege_audit_created' },
        { fields: ['target_user_id'], name: 'idx_privilege_audit_target' },
    ],
});

module.exports = PrivilegeAudit;
