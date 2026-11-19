const express = require('express');
const { NoticeReminder, Notice, sequelize } = require('../database/schemas');
const { userData } = require('../middlewares/userAuth');

const router = express.Router();

/**
 * Reminders on NOTICES. Deliberately mirrors routes/reminder.js (which is events-only) rather than
 * generalising it — see database/schemas/noticeReminder.js for why the tables are separate.
 *
 * Before this existed a notice bell wrote to localStorage and nowhere else, so it vanished with the
 * browser and the notification generator could never see it. The button looked identical to the
 * event one and quietly did less.
 */

// Highest first, deduped, positive integers only. Same rule as the events route.
const normalizeOffsetsMinutes = (offsets) => {
    if (!Array.isArray(offsets)) return [];
    const normalized = offsets
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value));
    return Array.from(new Set(normalized)).sort((a, b) => b - a);
};

const parseId = (value) => {
    if (!/^\d+$/.test(String(value))) return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

/**
 * The instant a notice's reminder should fire.
 *
 * A notice's moment is its `deadline` if it has one, else its `event_date` — matching what
 * NoticeActions.jsx offers the bell for. The time component is deadline_time / time_start, falling
 * back to 09:00 rather than midnight: a "closes today" alert at 00:00 is useless.
 *
 * Anchored to IST because those columns are wall-clock local, not instants. Without the offset the
 * whole feature would fire 5.5 hours out.
 */
const noticeMoment = (notice) => {
    const day = notice.deadline || notice.event_date;
    if (!day) return null;
    const time = notice.deadline_time || notice.time_start || '09:00';
    const at = new Date(`${String(day).slice(0, 10)}T${time}:00+05:30`);
    return Number.isFinite(at.getTime()) ? at : null;
};

// ── GET / — this user's notice reminders ────────────────────────────────────
router.get('/', userData, async (req, res) => {
    try {
        const rows = await NoticeReminder.findAll({
            where: { user_id: req.user.user_id },
            attributes: ['notice_id', 'offset_minutes'],
            // The notice's own fields come along so another device can rebuild the card from
            // scratch. Returning only ids would mean a reminder set on a phone shows as "off" on a
            // laptop, because the laptop has no local copy of the notice to render.
            include: [{ model: Notice, attributes: ['id', 'title', 'deadline', 'deadline_time', 'event_date', 'time_start'] }],
        });

        // Collapsed to one entry per notice: the client renders a single control with several
        // offsets selected, not one row per offset.
        const byNotice = new Map();
        for (const r of rows) {
            const n = r.Notice;
            if (!n) continue;                       // notice deleted under us; the FK cascade will tidy up
            const key = Number(r.notice_id);
            if (!byNotice.has(key)) {
                byNotice.set(key, {
                    // The `notice-` prefix is load-bearing on the client: eventReminders POSTs any
                    // purely numeric id to the EVENTS api, so a bare id here would write a reminder
                    // against an unrelated event.
                    id: `notice-${key}`,
                    notice_id: key,
                    name: n.title,
                    tentative_start_time: noticeMoment(n)?.toISOString() || null,
                    offsetsMinutes: [],
                });
            }
            byNotice.get(key).offsetsMinutes.push(Number(r.offset_minutes));
        }
        res.json({
            reminders: Array.from(byNotice.values())
                .map((n) => ({ ...n, offsetsMinutes: n.offsetsMinutes.sort((a, b) => b - a) })),
        });
    } catch (e) {
        console.error('notice reminders fetch failed:', e);
        res.status(500).json({ error: 'Could not fetch notice reminders' });
    }
});

// ── PUT /:noticeId — set the offsets for one notice ─────────────────────────
router.put('/:noticeId', userData, async (req, res) => {
    const noticeId = parseId(req.params.noticeId);
    if (!noticeId) return res.status(400).json({ error: 'Bad request', message: 'Invalid notice id' });

    const offsetsMinutes = normalizeOffsetsMinutes(req.body?.offsetsMinutes);
    if (offsetsMinutes.length === 0) {
        return res.status(400).json({ error: 'Bad request', message: 'At least one reminder offset is required' });
    }

    try {
        const userId = req.user.user_id;
        const notice = await Notice.findByPk(noticeId);
        if (!notice) return res.status(404).json({ error: 'Not found', message: 'Notice not found' });

        const moment = noticeMoment(notice);
        if (!moment) {
            return res.status(400).json({
                error: 'Bad request',
                message: 'This notice has no deadline or date to remind you about.',
            });
        }
        if (moment.getTime() <= Date.now()) {
            return res.status(400).json({ error: 'Bad request', message: 'That date has already passed' });
        }

        // Replace wholesale inside a transaction: the client sends the complete desired set, so a
        // partial failure must not leave a half-applied mix of old and new offsets.
        await sequelize.transaction(async (transaction) => {
            await NoticeReminder.destroy({ where: { notice_id: noticeId, user_id: userId }, transaction });
            await NoticeReminder.bulkCreate(
                offsetsMinutes
                    // An offset already in the past is silently dropped rather than rejected: asking
                    // for 1h on something due in 20 minutes should still give you the 15m and 5m.
                    .filter((offset) => moment.getTime() - offset * 60000 > Date.now())
                    .map((offset) => ({
                        notice_id: noticeId,
                        user_id: userId,
                        offset_minutes: offset,
                        reminder_time: new Date(moment.getTime() - offset * 60000),
                    })),
                { transaction },
            );
        });

        const saved = await NoticeReminder.findAll({
            where: { notice_id: noticeId, user_id: userId },
            attributes: ['offset_minutes'],
            raw: true,
        });
        res.json({
            reminder: {
                notice_id: noticeId,
                offsetsMinutes: saved.map((r) => Number(r.offset_minutes)).sort((a, b) => b - a),
            },
        });
    } catch (e) {
        console.error('notice reminder update failed:', e);
        res.status(500).json({ error: 'Could not update notice reminder' });
    }
});

// ── DELETE /:noticeId — turn the bell off ───────────────────────────────────
router.delete('/:noticeId', userData, async (req, res) => {
    const noticeId = parseId(req.params.noticeId);
    if (!noticeId) return res.status(400).json({ error: 'Bad request', message: 'Invalid notice id' });
    try {
        const removed = await NoticeReminder.destroy({
            where: { notice_id: noticeId, user_id: req.user.user_id },
        });
        res.json({ ok: true, removed });
    } catch (e) {
        console.error('notice reminder delete failed:', e);
        res.status(500).json({ error: 'Could not remove notice reminder' });
    }
});

module.exports = router;
