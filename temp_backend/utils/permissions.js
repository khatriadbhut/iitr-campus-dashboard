/**
 * Admin permissions: names in code, ids in the database.
 *
 * WHY THIS EXISTS
 * Permission checks used to compare against raw numbers sourced from six *_PERMISSION_ID env vars
 * (`admin_permission_id: 6`). That had three problems, and each is a documented anti-pattern:
 *
 *   1. Magic numbers. `6` tells a reader nothing; `PERM.MANAGE_CLUBS` tells them everything. Worse,
 *      the numbers had already drifted — middlewares/permissions/manageClubs.js defaulted to 7 while
 *      production, .env.example and every other file said 6. It only worked because the env var
 *      happened to be set; a rebuilt server would have silently 403'd every club-management action.
 *
 *   2. Wrong use of config. The twelve-factor definition of config is "everything that is likely to
 *      vary between deploys". Permission ids do NOT vary between deploys — manage_clubs is 6 in
 *      production, 6 in dev, 6 in a rebuilt database. They are domain constants that were living in
 *      environment variables, which is why an environment could contradict the code at all.
 *
 *   3. Ids are not stable identifiers. They come from insertion order. A database rebuilt from
 *      scratch numbers them differently — observed for real: a fresh test DB put manage_admins at 2
 *      instead of 4, and a super-admin was denied an upload as a result. Names never move on their
 *      own; changing one is a deliberate, reviewable edit.
 *
 * HOW IT WORKS
 * The name -> id map is read from the database ONCE at boot and cached. Permissions are reference
 * data that never changes at runtime, so there is no per-request cost — which answers the only real
 * argument for comparing raw ids. Foreign keys stay numeric; only the code-facing lookup is by name.
 *
 * Migration 20260805000000-seed-admin-permissions guarantees the rows exist with stable ids. This
 * module is what makes the code independent of what those ids actually turn out to be.
 */
const logger = require('./logger');

/** The canonical names. These are the contract — the migration seeds exactly these. */
const PERM = Object.freeze({
    EVENT_CRUD: 'event_crud',
    LOCATION_CRUD: 'location_crud',
    EVENT_CATEGORY_CRUD: 'event_category_crud',
    MANAGE_ADMINS: 'manage_admins',
    MANAGE_CLUB_ADMINS: 'manage_club_admins',
    MANAGE_CLUBS: 'manage_clubs',
});

let idByName = null;

/**
 * Resolve every permission name to its id. Call once during boot, before serving traffic.
 * Throws if any permission is missing — a missing row would otherwise surface much later as an
 * unexplained 403 for an admin who genuinely holds the permission, which is far harder to diagnose
 * than refusing to start.
 */
async function loadPermissionIds() {
    const { AdminPermission } = require('../database/schemas');
    const rows = await AdminPermission.findAll({ attributes: ['id', 'name'], raw: true });

    const map = new Map(rows.map((r) => [r.name, Number(r.id)]));
    const missing = Object.values(PERM).filter((name) => !map.has(name));
    if (missing.length) {
        throw new Error(
            `admin_permission is missing: ${missing.join(', ')}. ` +
            'Run migrations (20260805000000-seed-admin-permissions) before starting.'
        );
    }

    idByName = map;

    // Surface drift rather than hiding it: everything still works (we use the real id), but an
    // environment whose ids differ from the seed is worth knowing about before it confuses someone.
    const expected = { event_crud: 1, location_crud: 2, event_category_crud: 3, manage_admins: 4, manage_club_admins: 5, manage_clubs: 6 };
    const drifted = Object.entries(expected).filter(([n, i]) => map.get(n) !== i);
    if (drifted.length) {
        logger.warn(
            { drifted: drifted.map(([n, i]) => `${n}: expected ${i}, found ${map.get(n)}`) },
            'admin_permission ids differ from the seeded values — resolving by name, so this is handled'
        );
    }

    return idByName;
}

/** The id for a permission name. Boot-time resolved, so this is a plain Map read. */
function permissionId(name) {
    if (!idByName) throw new Error('loadPermissionIds() has not run — call it during boot');
    const id = idByName.get(name);
    if (id === undefined) throw new Error(`Unknown permission: ${name}`);
    return id;
}

/** Several ids at once, for `where: { admin_permission_id: permissionIds(...) }`. */
function permissionIds(...names) {
    return names.flat().map(permissionId);
}

module.exports = { PERM, loadPermissionIds, permissionId, permissionIds };
