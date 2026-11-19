'use strict';

/**
 * Give every user a token_version, so a session can actually be revoked.
 *
 * Until now logout only called res.clearCookie — it told THAT browser to forget the token, but the
 * token itself stayed valid for its full 30 days. There was no denylist, no session table and no
 * version claim, so a leaked token could not be killed. The only lever was rotating JWT_SECRET, which
 * logs out every user at once.
 *
 * The version is stamped into the JWT at login and compared on each request; bumping it invalidates
 * every token that account has ever been issued. Authorization was never the problem — permissions are
 * re-read from the DB on every request — this is about revoking IDENTITY.
 */
module.exports = {
    async up(queryInterface, Sequelize) {
        const table = await queryInterface.describeTable('user');
        if (!table.token_version) {
            await queryInterface.addColumn('user', 'token_version', {
                type: Sequelize.INTEGER, allowNull: false, defaultValue: 0,
            });
        }
    },

    async down(queryInterface) {
        const table = await queryInterface.describeTable('user');
        if (table.token_version) await queryInterface.removeColumn('user', 'token_version');
    },
};
