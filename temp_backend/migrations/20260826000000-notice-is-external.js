'use strict';

/**
 * Mark whether a notice is run by someone OTHER than IIT Roorkee.
 *
 * The Notices tab mixes two things a student reads completely differently: a campus deadline they are
 * subject to, and an outside competition they may choose to enter. "Hackathon on R&D 2026" and "Course
 * Drop Option on AIS Portal" look alike in the list, and nothing on the card says one is run by CMPDI
 * and the other by the academic section.
 *
 * Additive, nullable-with-default-false, so existing rows are valid immediately; the accompanying
 * backfill (backfillNoticeExternal.js) fills them in from the same rule the pipeline uses.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        const table = await queryInterface.describeTable('notice');
        if (!table.is_external) {
            await queryInterface.addColumn('notice', 'is_external', {
                type: Sequelize.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            });
        }
    },

    async down(queryInterface) {
        const table = await queryInterface.describeTable('notice');
        if (table.is_external) await queryInterface.removeColumn('notice', 'is_external');
    },
};
