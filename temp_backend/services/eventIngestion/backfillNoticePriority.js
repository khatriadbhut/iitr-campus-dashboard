/**
 * Re-run the CURRENT classification rules over notices already in the database.
 *
 * Why this exists: notice rows are written once by the publish step and then largely left alone. When
 * the importance rule was rewritten on 2026-08-22 (from "the topic sounds official" to "ignoring this
 * costs you something"), every row written before that kept its old priority. Measured 2026-08-26:
 * production stood at 25/38 important (66%) while the deployed code computed 8/38 (21%) for the same
 * titles. The band users see was two-thirds of the list — no signal at all — purely because nothing
 * ever re-applied the fix to stored rows.
 *
 * It now backfills two flags:
 *   · is_external — run by someone other than IIT Roorkee (drives the EXTERNAL chip)
 *   · priority    — the pinned IMPORTANT band; yields to is_external, since an outside body's
 *                   competition is never a campus obligation
 *
 * Neither rule is re-implemented here. Both are imported from the pipeline, because a second copy of
 * a rule is exactly how the data drifts away from the code a second time.
 *
 *   node services/eventIngestion/backfillNoticePriority.js            # dry run, prints the diff
 *   node services/eventIngestion/backfillNoticePriority.js --apply    # writes
 *
 * Only `priority` and `is_external` are touched. Nothing is deleted; no other column is rewritten.
 */
const { Notice } = require('../../database/schemas/index');
const { isImportantNotice, isExternalNotice } = require('./index');

const APPLY = process.argv.includes('--apply');

const classify = (r) => {
    const external = isExternalNotice(r.title, r.body, r.link);
    return { external, priority: isImportantNotice(r.title, r.kind, external, !!(r.deadline || r.event_date)) ? 'important' : 'general' };
};

(async () => {
    const rows = await Notice.findAll({ raw: true, order: [['id', 'ASC']] });

    const changes = [];
    for (const r of rows) {
        const want = classify(r);
        const diff = {};
        if (want.priority !== r.priority) diff.priority = { from: r.priority, to: want.priority };
        if (want.external !== !!r.is_external) diff.is_external = { from: !!r.is_external, to: want.external };
        if (Object.keys(diff).length) changes.push({ id: r.id, title: r.title, kind: r.kind, diff });
    }

    const impBefore = rows.filter((r) => r.priority === 'important').length;
    const impAfter = rows.filter((r) => classify(r).priority === 'important').length;
    const extAfter = rows.filter((r) => classify(r).external).length;
    const pct = (n) => `${n}/${rows.length} (${Math.round((n / rows.length) * 100)}%)`;

    console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} — ${rows.length} notices`);
    console.log(`important : ${pct(impBefore)}  ->  ${pct(impAfter)}`);
    console.log(`external  : ${pct(rows.filter((r) => !!r.is_external).length)}  ->  ${pct(extAfter)}`);
    console.log(`rows changing: ${changes.length}\n`);

    for (const c of changes) {
        const parts = Object.entries(c.diff).map(([k, v]) => `${k}: ${v.from} -> ${v.to}`).join(', ');
        console.log(`   #${c.id} [${c.kind}] ${String(c.title).slice(0, 58)}\n        ${parts}`);
    }

    if (!APPLY) {
        console.log('\nDry run only — nothing written. Re-run with --apply to commit these.');
        process.exit(0);
    }

    let n = 0;
    for (const c of changes) {
        const patch = {};
        for (const [k, v] of Object.entries(c.diff)) patch[k] = v.to;
        await Notice.update(patch, { where: { id: c.id } });
        n++;
    }
    console.log(`\n✓ updated ${n} notice(s).`);
    process.exit(0);
})().catch((e) => {
    console.error('backfill failed:', e.message);
    process.exit(1);
});
