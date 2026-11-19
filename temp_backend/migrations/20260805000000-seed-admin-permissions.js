'use strict';

/**
 * Seed admin_permission with EXPLICIT, FIXED ids.
 *
 * Until now only `event_crud` (id 1) was created, by initializeSchema. The other five appeared as a
 * side effect of whatever code happened to need them first — dev-login calls findOrCreate for
 * `manage_admins`, for instance — so their ids came from insertion order rather than from anything
 * deliberate. Six *_PERMISSION_ID env vars then papered over the gap by telling each deployment which
 * number meant what.
 *
 * That works only while the numbers and the env vars agree. They do in production today (verified:
 * 1..6 exactly as documented, and all six vars set). But nothing enforces it, and it fails in the one
 * situation where you can least afford surprises: rebuilding the database from scratch. A fresh DB
 * assigns different ids, the env vars then point at the wrong rows, and permission checks silently
 * return 403 — no error, no log, just admins who can't do their jobs. This was observed for real: an
 * integration test against a fresh database put `manage_admins` at id 2, and a super-admin was denied
 * an upload as a result.
 *
 * Seeding reference data in a migration with explicit ids is the standard fix. Permissions are a
 * small, stable, enum-like lookup table — exactly the case where fixed identifiers belong in version
 * control rather than being derived at runtime. Every environment now converges on the same six rows.
 *
 * Deliberately additive and idempotent: it inserts only what is missing and never renumbers an
 * existing row, because admin_permission_alloted already references these ids. Running it against
 * production is a no-op.
 */

// The canonical set. Ids here are the contract the *_PERMISSION_ID env vars and the code defaults
// both assume — keep them in sync with .env.example if this list ever grows.
const PERMISSIONS = [
    { id: 1, name: 'event_crud' },
    { id: 2, name: 'location_crud' },
    { id: 3, name: 'event_category_crud' },
    { id: 4, name: 'manage_admins' },
    { id: 5, name: 'manage_club_admins' },
    { id: 6, name: 'manage_clubs' },
];

module.exports = {
    async up(queryInterface) {
        const [existing] = await queryInterface.sequelize.query(
            'SELECT id, name FROM admin_permission'
        );
        const byId = new Map(existing.map((r) => [Number(r.id), r.name]));
        const byName = new Map(existing.map((r) => [r.name, Number(r.id)]));

        for (const perm of PERMISSIONS) {
            const idTaken = byId.get(perm.id);
            const nameAt = byName.get(perm.name);

            if (nameAt === perm.id) continue;                       // already correct

            if (nameAt !== undefined && nameAt !== perm.id) {
                // The name exists under a different id. Renumbering would orphan every row in
                // admin_permission_alloted that points at it, so leave it and make the mismatch loud
                // — this environment needs its *_PERMISSION_ID env vars set to match reality.
                console.warn(
                    `⚠️  '${perm.name}' exists at id ${nameAt}, expected ${perm.id}. Not renumbering ` +
                    `(admin_permission_alloted references it). Set the matching *_PERMISSION_ID env var.`
                );
                continue;
            }

            if (idTaken !== undefined) {
                console.warn(`⚠️  id ${perm.id} is held by '${idTaken}', expected '${perm.name}'. Skipping.`);
                continue;
            }

            await queryInterface.sequelize.query(
                'INSERT INTO admin_permission (id, name) VALUES (:id, :name) ON CONFLICT (id) DO NOTHING',
                { replacements: perm }
            );
            console.log(`✅ seeded admin_permission ${perm.id} = ${perm.name}`);
        }

        // Postgres SERIAL sequences don't advance when ids are supplied explicitly, so the next
        // auto-generated insert would collide with a seeded row. Fast-forward past the seeded range.
        await queryInterface.sequelize.query(`
            SELECT setval(
                pg_get_serial_sequence('admin_permission', 'id'),
                GREATEST((SELECT COALESCE(MAX(id), 1) FROM admin_permission), 1)
            )
        `).catch(() => { /* no sequence (non-serial pk) — nothing to fix */ });
    },

    async down() {
        // Intentionally a no-op. Deleting permission rows would cascade to admin_permission_alloted
        // and strip every admin of their access — far worse than leaving six reference rows behind.
    },
};
