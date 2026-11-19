'use strict';

/**
 * Append-only trail of privilege changes (institute admins AND club admins).
 *
 * Granting admin was previously invisible: no record of who granted what to whom, so someone gaining
 * admin looked exactly like someone who always had it. With a small admin team, detection beats
 * prevention — an unexpected alert is instantly recognisable, and this table is what makes it possible
 * to work out what happened and undo it.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        const tables = await queryInterface.showAllTables();
        if (tables.includes('privilege_audit')) return;
        await queryInterface.createTable('privilege_audit', {
            id: { type: Sequelize.BIGINT, primaryKey: true, autoIncrement: true },
            action: { type: Sequelize.STRING(32), allowNull: false },
            actor_user_id: { type: Sequelize.BIGINT, allowNull: true },
            target_user_id: { type: Sequelize.BIGINT, allowNull: true },
            detail: { type: Sequelize.JSONB, allowNull: true },
            ip: { type: Sequelize.STRING(64), allowNull: true },
            created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        });
        await queryInterface.addIndex('privilege_audit', ['created_at'], { name: 'idx_privilege_audit_created' });
        await queryInterface.addIndex('privilege_audit', ['target_user_id'], { name: 'idx_privilege_audit_target' });
    },

    async down(queryInterface) {
        const tables = await queryInterface.showAllTables();
        if (tables.includes('privilege_audit')) await queryInterface.dropTable('privilege_audit');
    },
};
