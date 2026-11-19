'use strict';
const fs = require('fs');
const path = require('path');

/**
 * BASELINE migration — captures the full current schema (from a pg_dump of the live schema, incl. the
 * perf indexes). It is GUARDED so it's safe against an ALREADY-populated DB:
 *   - existing DB (the `event` table exists) → no-op, but sequelize-cli STILL writes its row to
 *     SequelizeMeta, so it's "marked applied" without recreating anything (the missing `--fake` trick).
 *   - fresh DB (CI, a new dev machine) → runs the full baseline SQL to create everything.
 * From here on, every schema change is a NEW migration file. down() is intentionally irreversible —
 * you never roll back a baseline; roll forward + restore an RDS snapshot if needed.
 */
module.exports = {
    async up(queryInterface) {
        const [rows] = await queryInterface.sequelize.query(
            "SELECT to_regclass('public.event') IS NOT NULL AS exists"
        );
        if (rows[0] && rows[0].exists) {
            // eslint-disable-next-line no-console
            console.log('baseline: existing schema detected → no-op (recorded as applied).');
            return;
        }
        const sql = fs.readFileSync(path.join(__dirname, 'sql', '0001-baseline.sql'), 'utf8');
        await queryInterface.sequelize.query(sql);
    },

    async down() {
        throw new Error('The baseline migration is not reversible. Restore an RDS snapshot instead.');
    },
};
