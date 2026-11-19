#!/usr/bin/env node
/**
 * Replay ALREADY-INGESTED mail through the real classification path, and print what it decides.
 *
 * WHY THIS EXISTS: "why did today's event not appear?" is otherwise unanswerable without either
 * guessing or re-pulling the mailbox. This answers it from what is already stored.
 *
 * READ-ONLY, and that is the entire point — it must be safe to run against production while people
 * are using the app. It never contacts Gmail, never writes a proposal, never advances a watermark and
 * never touches ingested_email. `overrides` is deliberately passed as null: the one write buried in
 * reviewProposals is a hit_count bump on a matched override, and that path is skipped entirely.
 *
 * It runs runPipeline + reviewProposals — the PRODUCTION path, including the Groq layer — not the
 * deterministic regex pass on its own. Measuring the fallback and reporting it as the app's behaviour
 * is a mistake this project has made before; the two disagree, and the LLM owns the final category.
 *
 * WHAT IT CANNOT REPRODUCE, stated plainly: the gate decision. Gates read List-* headers and
 * Authentication-Results, and those are never stored — mail is gated BEFORE any body is persisted, on
 * purpose. So a message dismissed at a gate has no body here to replay, and its recorded reason is
 * the only evidence there is. For anything that reached `parsed`, the classification below is what
 * production ran.
 *
 * Usage:
 *   node scripts/replay-email.js --hours 36          # a window, newest first (capped at 25)
 *   node scripts/replay-email.js --id 1141           # one ingested_email row
 *   node scripts/replay-email.js --hours 72 --limit 60
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { IngestedEmail, EventProposal, sequelize } = require('../database/schemas');
const { runPipeline } = require('../services/eventIngestion');
const {
    reviewProposals, loadSenderMap, loadClubIndex, loadCalendarEntries,
} = require('../services/eventIngestion/runner');
const groq = require('../services/eventIngestion/review/groq');

const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

/**
 * Rebuild the shape the pipeline expects from a stored row.
 *
 * `cc` cannot be recovered — only from/to are persisted — and cc feeds ATTRIBUTION, because clubs
 * routinely mail through a relay and copy their own address. So an attributed club here may be
 * thinner than the one production produced. It does not affect whether a proposal exists, which is
 * what this script is for.
 */
const toEmail = (row) => ({
    message_id: row.message_id,
    gmail_id: (row.raw_snapshot || {}).gmail_id || null,
    thread_id: row.thread_id,
    from: row.from_addr || '',
    to: row.to_addrs || '',
    cc: '',
    subject: row.subject || '',
    body_text: row.body_text || '',
    internal_date: row.internal_date,
});

(async () => {
    const where = {};
    if (arg('id')) where.id = Number(arg('id'));
    else {
        const hours = Number(arg('hours', 36));
        where.internal_date = { [require('sequelize').Op.gt]: new Date(Date.now() - hours * 3600e3) };
    }

    // HARD CAP, newest first. Every replayed message costs a Groq call, and the account limit is a
    // daily one shared with the live ingest — a careless `--hours 720` would spend the app's own
    // classification budget on a diagnostic and quietly drop real mail to the regex fallback for the
    // rest of the day. Widen it deliberately with --limit, never by accident.
    const limit = Math.min(Number(arg('limit', 25)), 200);
    const total = await IngestedEmail.count({ where });
    const rows = await IngestedEmail.findAll({ where, order: [['internal_date', 'DESC']], limit });

    console.log(`\nReplaying ${rows.length} of ${total} matching message(s)`
        + `${total > rows.length ? ` — capped by --limit ${limit}` : ''}.`
        + `  Groq configured: ${groq.isConfigured()}\n`);

    const [senderMap, clubIndex, calendarEntries] = await Promise.all([
        loadSenderMap(), loadClubIndex(), loadCalendarEntries(),
    ]);

    for (const row of rows) {
        const when = new Date(row.internal_date).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' });
        console.log('─'.repeat(100));
        console.log(`#${row.id}  ${when} IST`);
        console.log(`  from    : ${row.from_addr}`);
        console.log(`  subject : ${row.subject}`);
        console.log(`  stored  : state=${row.state}${row.error ? `  reason=${row.error}` : ''}`);

        // What actually resulted, so the replay can be compared against reality rather than trusted.
        const existing = await EventProposal.findAll({
            where: { ingested_email_id: row.id }, order: [['id', 'ASC']], raw: true,
        });
        console.log(`  became  : ${existing.length
            ? existing.map((p) => `proposal #${p.id} ${p.mutation_type} [${p.state}]`).join(', ')
            : 'no proposal'}`);

        if (!row.body_text) {
            console.log('  replay  : skipped — body was never stored (gated before persistence)\n');
            continue;
        }

        const email = toEmail(row);
        let proposals;
        try {
            proposals = runPipeline(email, { senderMap, clubIndex, calendarEntries });
        } catch (e) {
            console.log(`  replay  : runPipeline THREW — ${e.message}\n`);
            continue;
        }

        console.log(`  deterministic → ${proposals.length
            ? proposals.map((p) => `${p.mutation_type}${p.payload?.kind ? `/${p.payload.kind}` : ''}`).join(', ')
            : 'NOTHING (no proposal produced)'}`);

        if (!proposals.length) { console.log(); continue; }

        // overrides = null on purpose: skips the only write reviewProposals can make.
        const out = {};
        const reviewed = await reviewProposals(email, proposals, senderMap, out, null, clubIndex, calendarEntries);
        for (const p of reviewed) {
            const ev = p.evidence || {};
            console.log(`  final         → ${p.mutation_type}${p.payload?.kind ? `/${p.payload.kind}` : ''}`
                + `  club=${p.club || '—'}  via=${ev.source || '?'}`);
            if (p.payload?.title) console.log(`     title      : ${p.payload.title}`);
            if (p.payload?.tentative_start_time) console.log(`     starts     : ${p.payload.tentative_start_time}`);
            if (ev.llm_type || ev.llm_kind) console.log(`     llm said   : ${ev.llm_type || '—'}/${ev.llm_kind || '—'}`);
            if (ev.llm_error) console.log('     llm        : ERRORED — fell back to deterministic');
        }
        console.log();
    }

    console.log('─'.repeat(100));
    console.log('Read-only: nothing was written, no mail was fetched, no watermark moved.\n');
    await sequelize.close();
    process.exit(0);
})().catch((e) => { console.error('replay failed:', e); process.exit(1); });
