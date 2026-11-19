'use strict';

/**
 * Give a notice a WHEN and a WHERE.
 *
 * Until now `notice` had exactly one date column, `deadline`, which means "apply by" and drives expiry.
 * So when the classifier decided an email was a notice rather than an event, the extracted date/time/venue
 * had nowhere to live and were silently dropped — the date looked "erased" even though extraction had it.
 * Measured on the 435-mail corpus, that was a date on 31% and a time on 28% of notices thrown away.
 *
 * `deadline` keeps its apply-by meaning; these three carry when the thing actually HAPPENS.
 * Additive and nullable, so existing rows are untouched and no backfill is required.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        const table = await queryInterface.describeTable('notice');
        const add = (name, spec) => (table[name] ? Promise.resolve() : queryInterface.addColumn('notice', name, spec));
        await add('event_date', { type: Sequelize.DATEONLY, allowNull: true });
        await add('time_start', { type: Sequelize.STRING(5), allowNull: true });   // "HH:MM" IST, as on event
        await add('venue', { type: Sequelize.TEXT, allowNull: true });
    },

    async down(queryInterface) {
        const table = await queryInterface.describeTable('notice');
        for (const c of ['event_date', 'time_start', 'venue']) {
            if (table[c]) await queryInterface.removeColumn('notice', c);
        }
    },
};
