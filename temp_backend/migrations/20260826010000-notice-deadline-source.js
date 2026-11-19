'use strict';

/**
 * Where a notice's deadline came from.
 *
 * Some notices state no date at all and point at the academic calendar instead — "Please refer to the
 * Academic Calendar (Autumn Semester 2026-27) for last date for withdrawal of courses". The app has
 * already parsed that calendar, so it holds the answer the email is pointing at, in another table.
 *
 * Filling the deadline in from there is worth doing, but it must stay DISTINGUISHABLE from a date the
 * email actually stated: a derived date is an inference, and an inference that is wrong should be
 * visible and correctable rather than indistinguishable from a fact.
 *
 * null = stated by the email (or set by a human). 'calendar' = derived from an academic calendar entry.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        const table = await queryInterface.describeTable('notice');
        if (!table.deadline_source) {
            await queryInterface.addColumn('notice', 'deadline_source', { type: Sequelize.STRING(16), allowNull: true });
        }
    },
    async down(queryInterface) {
        const table = await queryInterface.describeTable('notice');
        if (table.deadline_source) await queryInterface.removeColumn('notice', 'deadline_source');
    },
};
