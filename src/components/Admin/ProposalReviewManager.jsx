import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Check, X, Send, Inbox, RefreshCw, AlertTriangle, Sparkles, Cpu, Download } from 'lucide-react';
import ingestionService from '../../services/ingestion';
import NoticeFields from './NoticeFields';
import clubsService from '../../services/clubs';
import miscService from '../../services/misc';
import { notify } from '../../services/notify';
import { mergeTargetIntoDraft } from '../../utils/updateDraft';
import './ProposalReviewManager.css';

// which review bucket a proposal belongs to
const bucketOf = (p) => {
    if (p.mutation_type === 'CREATE_EVENT') return 'events';
    if (p.mutation_type === 'CALENDAR_ENTRY') return 'calendar';
    if (p.mutation_type === 'PATCH_EVENT' || p.mutation_type === 'CANCEL_EVENT' || p.mutation_type === 'PATCH_NOTICE') return 'lifecycle';
    return 'notices';
};
// One bucket per THING BEING REVIEWED. "Opportunities" and "Info" used to sit here as two separate
// tabs, but they are not two kinds of proposal — they are a sub-categorisation OF a notice, decided by
// the pipeline and shown on the card. Splitting the queue by them meant a reviewer had to check two
// tabs to see all the notices, and had to know which side of that split an item had landed on to find
// it at all. The distinction is still visible per card, where it belongs.
const BUCKETS = [
    ['events', 'Events'], ['notices', 'Notices'],
    ['calendar', 'Calendar'], ['lifecycle', 'Updates'],
];
const PUBLISHABLE = new Set(['events', 'notices']);   // calendar/lifecycle: dismiss or handle manually

// Calendar proposals are amend-or-add against the academic calendar, so they get their own card:
// fetch candidate existing entries the email might change, let the admin pick amend-that vs add-new.
function CalendarCard({ p, onDone }) {
    const [cands, setCands] = useState(null);
    const [mode, setMode] = useState('add');           // 'add' | <targetEntryId>
    const [title, setTitle] = useState(p.payload.title || '');
    const [date, setDate] = useState(p.payload.startDate || '');
    const [busy, setBusy] = useState(false);
    const isHoliday = p.payload.cal_kind === 'holiday';
    useEffect(() => {
        ingestionService.getCalendarCandidates(p.id).then((r) => setCands(r.candidates || [])).catch(() => setCands([]));
    }, [p.id]);

    const apply = async () => {
        setBusy(true);
        const body = { payload: { title, startDate: date || null },
            mode: mode === 'add' ? 'add' : 'amend', targetId: mode === 'add' ? undefined : mode };
        try { await ingestionService.publishProposal(p.id, body); notify(mode === 'add' ? 'Added to calendar.' : 'Calendar updated.', 'success'); onDone(p.id); }
        catch { notify('Calendar update failed.', 'error'); } finally { setBusy(false); }
    };
    const dismiss = async () => {
        setBusy(true);
        try { await ingestionService.dismissProposal(p.id); onDone(p.id); }
        catch { notify('Dismiss failed.', 'error'); } finally { setBusy(false); }
    };

    return (
        <div className="pr-card card">
            <div className="pr-card-top">
                <span className="pr-type t-calendar">{isHoliday ? 'HOLIDAY' : 'WORKING DAY'}</span>
                <span className="pr-kind">academic calendar</span>
            </div>
            <input className="pr-input pr-title-in" value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="pr-fields">
                <label className="pr-field"><span>Date</span><input type="date" className="pr-input" value={date || ''} onChange={(e) => setDate(e.target.value)} /></label>
            </div>
            <div className="pr-cal-choice">
                <div className="pr-cal-label">Apply as:</div>
                <label className="pr-cal-opt"><input type="radio" checked={mode === 'add'} onChange={() => setMode('add')} /> Add new {isHoliday ? 'holiday' : 'working day'}</label>
                {cands === null ? <span className="pr-muted pr-cal-opt">finding matches…</span>
                    : cands.map((c) => (
                        <label key={c.id} className="pr-cal-opt">
                            <input type="radio" checked={mode === c.id} onChange={() => setMode(c.id)} />
                            {' '}Amend: <strong>{(c.title || '').slice(0, 46)}</strong> <span className="pr-muted">({c.start_date || 'TBD'})</span>
                        </label>
                    ))}
            </div>
            <div className="pr-actions">
                <button className="btn btn-yellow pr-pub" disabled={busy || !title} onClick={apply}>
                    <Send size={14} /> {mode === 'add' ? 'Add to calendar' : 'Apply change'}
                </button>
                <button className="btn btn-outline pr-dis" disabled={busy} onClick={dismiss}><X size={14} /> Dismiss</button>
            </div>
        </div>
    );
}

// A deadline EXTENSION applies against a LIVE notice the admin picks — same never-auto-target rule as
// the event lifecycle. Only the apply-by moves, so the card offers just the new date and closing time.
function DeadlineExtensionCard({ p, onDone }) {
    const [cands, setCands] = useState(null);
    const [target, setTarget] = useState('');
    const [date, setDate] = useState(p.payload.deadline || '');
    const [time, setTime] = useState(p.payload.deadline_time || '');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        ingestionService.getNoticeCandidates(p.id).then((r) => setCands(r.candidates || [])).catch(() => setCands([]));
    }, [p.id]);

    const apply = async () => {
        setBusy(true);
        const body = { payload: { deadline: date || null, deadline_time: time || null }, targetId: target };
        try { await ingestionService.publishProposal(p.id, body); notify('Deadline extended.', 'success'); onDone(p.id); }
        catch (e) { notify(e?.response?.data?.error || 'Extension failed.', 'error'); } finally { setBusy(false); }
    };
    const dismiss = async () => {
        setBusy(true);
        try { await ingestionService.dismissProposal(p.id); onDone(p.id); }
        catch { notify('Dismiss failed.', 'error'); } finally { setBusy(false); }
    };

    return (
        <div className="pr-card card">
            <div className="pr-card-top">
                <span className="pr-type t-lifecycle">DEADLINE EXTENDED</span>
                <span className="pr-kind">moves a live notice&apos;s apply-by</span>
            </div>
            <div className="pr-title-in pr-muted">{p.payload.title || '(no subject)'}</div>
            <div className="pr-fields">
                <label className="pr-field"><span>New deadline</span><input type="date" className="pr-input" value={date || ''} onChange={(e) => setDate(e.target.value)} /></label>
                <label className="pr-field"><span>Closes at</span><input type="time" className="pr-input" value={time || ''} onChange={(e) => setTime(e.target.value)} placeholder="end of day" /></label>
            </div>
            <div className="pr-cal-choice">
                <div className="pr-cal-label">Extend which notice:</div>
                {cands === null ? <span className="pr-muted pr-cal-opt">finding matches…</span>
                    : cands.length === 0 ? <span className="pr-muted pr-cal-opt">No matching live notice — dismiss, or publish the original notice first.</span>
                        : cands.map((c) => (
                            <label key={c.id} className="pr-cal-opt">
                                <input type="radio" checked={target === c.id} onChange={() => setTarget(c.id)} />
                                {' '}<strong>{(c.title || '').slice(0, 46)}</strong> <span className="pr-muted">(closes {c.deadline || 'TBD'})</span>
                            </label>
                        ))}
            </div>
            <div className="pr-actions">
                <button className="btn btn-yellow pr-pub" disabled={busy || !target || !date} onClick={apply}>
                    <Send size={14} /> Apply extension
                </button>
                <button className="btn btn-outline pr-dis" disabled={busy} onClick={dismiss}><X size={14} /> Dismiss</button>
            </div>
        </div>
    );
}

// PATCH/CANCEL proposals apply against a LIVE event the admin must pick (we never auto-target). Cancel
// flags the event cancelled; Patch moves its date / records a venue change. No match → dismiss only.
function LifecycleCard({ p, onDone }) {
    const isCancel = p.mutation_type === 'CANCEL_EVENT';
    const [cands, setCands] = useState(null);
    const [target, setTarget] = useState('');           // chosen live event id (required to apply)
    const [title, setTitle] = useState(p.payload.title || '');
    const [date, setDate] = useState(p.payload.startDate || '');
    const [venue, setVenue] = useState(p.payload.venue || '');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        ingestionService.getEventCandidates(p.id).then((r) => setCands(r.candidates || [])).catch(() => setCands([]));
    }, [p.id]);

    const apply = async () => {
        setBusy(true);
        const body = { payload: { title, startDate: isCancel ? null : (date || null), venue: venue || null }, targetId: target };
        try { await ingestionService.publishProposal(p.id, body); notify(isCancel ? 'Event cancelled.' : 'Event updated.', 'success'); onDone(p.id); }
        catch (e) { notify(e?.response?.data?.error || 'Update failed.', 'error'); } finally { setBusy(false); }
    };
    const dismiss = async () => {
        setBusy(true);
        try { await ingestionService.dismissProposal(p.id); onDone(p.id); }
        catch { notify('Dismiss failed.', 'error'); } finally { setBusy(false); }
    };

    return (
        <div className="pr-card card">
            <div className="pr-card-top">
                <span className={`pr-type t-lifecycle`}>{isCancel ? 'CANCEL' : 'RESCHEDULE'}</span>
                <span className="pr-kind">applies to a live event</span>
            </div>
            <input className="pr-input pr-title-in" value={title} onChange={(e) => setTitle(e.target.value)} />
            {!isCancel && (
                <div className="pr-fields">
                    <label className="pr-field"><span>New date</span><input type="date" className="pr-input" value={date || ''} onChange={(e) => setDate(e.target.value)} /></label>
                    <label className="pr-field pr-wide"><span>New venue</span><input className="pr-input" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="unchanged" /></label>
                </div>
            )}
            <div className="pr-cal-choice">
                <div className="pr-cal-label">{isCancel ? 'Cancel which event:' : 'Update which event:'}</div>
                {cands === null ? <span className="pr-muted pr-cal-opt">finding matches…</span>
                    : cands.length === 0 ? <span className="pr-muted pr-cal-opt">No matching live event — dismiss, or publish the source as a new event/notice first.</span>
                        : cands.map((c) => (
                            <label key={c.id} className="pr-cal-opt">
                                <input type="radio" checked={target === c.id} onChange={() => setTarget(c.id)} />
                                {' '}<strong>{(c.name || '').slice(0, 46)}</strong> <span className="pr-muted">({c.start ? new Date(c.start).toLocaleDateString() : 'TBD'})</span>
                            </label>
                        ))}
            </div>
            <div className="pr-actions">
                <button className="btn btn-yellow pr-pub" disabled={busy || !target} onClick={apply}>
                    <Send size={14} /> {isCancel ? 'Cancel event' : 'Apply update'}
                </button>
                <button className="btn btn-outline pr-dis" disabled={busy} onClick={dismiss}><X size={14} /> Dismiss</button>
            </div>
        </div>
    );
}

// Super-admin only: turn a correction into a scoped rule (sender[+subject pattern] → type). Shows a
// retro-match preview (how many past emails it would re-type) BEFORE saving — the blast-radius check.
function RuleForm({ p, defaultType, onClose }) {
    const rawFrom = p.payload._from || '';
    const sender = (rawFrom.match(/<([^>]+)>/)?.[1] || rawFrom).toLowerCase().trim();
    const [pattern, setPattern] = useState('');
    const [type, setType] = useState(defaultType || 'notice');
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);

    const runPreview = async () => {
        try { setPreview(await ingestionService.previewOverride(sender, pattern)); }
        catch { setPreview({ count: '?', samples: [] }); }
    };
    useEffect(() => { runPreview(); /* eslint-disable-next-line */ }, [pattern]);

    const save = async () => {
        setBusy(true);
        try {
            await ingestionService.createOverride({ sender, pattern: pattern || null, target_type: type });
            notify(`Rule saved — future mail from ${sender}${pattern ? ` about "${pattern}"` : ''} → ${type}.`, 'success');
            onClose();
        } catch (e) { notify(e?.response?.data?.error || 'Could not save rule.', 'error'); } finally { setBusy(false); }
    };

    return (
        <div className="pr-rule">
            <div className="pr-rule-title">⚙ Save as rule <span className="pr-muted">(applies to future mail, super-admin)</span></div>
            <div className="pr-rule-row">
                <span className="pr-muted">From</span> <strong>{sender}</strong>
                <span className="pr-muted">→</span>
                <select className="pr-input pr-rule-sel" value={type} onChange={(e) => setType(e.target.value)}>
                    <option value="event">Event</option><option value="opportunity">Opportunity</option>
                    <option value="notice">Info</option><option value="calendar">Calendar</option>
                </select>
            </div>
            <label className="pr-field pr-wide"><span>Only when subject contains (optional; required for relay senders)</span>
                <input className="pr-input" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. fellowship" />
            </label>
            {preview && (
                <div className="pr-rule-preview">
                    Would re-type <strong>{preview.count}</strong> of the last 90 days’ emails from this sender.
                    {(preview.samples || []).length > 0 && <ul>{preview.samples.slice(0, 4).map((s, i) => <li key={i}>{s}</li>)}</ul>}
                </div>
            )}
            <div className="pr-actions">
                <button className="btn btn-yellow" disabled={busy} onClick={save}>Save rule</button>
                <button className="btn btn-outline" disabled={busy} onClick={onClose}>Cancel</button>
            </div>
        </div>
    );
}

export default function ProposalReviewManager({ isSuperAdmin = false }) {
    const [proposals, setProposals] = useState(null);
    const [status, setStatus] = useState(null);
    const [filter, setFilter] = useState('events');
    const [drafts, setDrafts] = useState({});
    const [busy, setBusy] = useState(() => new Set());
    const [pulling, setPulling] = useState(false);
    const [ruleFor, setRuleFor] = useState(null);   // proposal id whose "save as rule" form is open
    // The club roster, fetched once for the whole queue rather than per card — a busy queue renders 60
    // cards, and each one asking for the same list would be 60 identical requests. Passed down to
    // NoticeFields, which otherwise fetches its own.
    const [clubs, setClubs] = useState([]);
    useEffect(() => { clubsService.getAllClubs().then(setClubs).catch(() => setClubs([])); }, []);
    const [cands, setCands] = useState({});         // PATCH_EVENT id → live events it could be updating
    const [targets, setTargets] = useState({});     // PATCH_EVENT id → the live event id chosen
    const [allCats, setAllCats] = useState([]);     // event categories for the parity multi-select
    useEffect(() => { miscService.getAllEventCategories().then((c) => setAllCats(Array.isArray(c) ? c : [])).catch(() => setAllCats([])); }, []);

    const load = useCallback(async () => {
        try {
            const [pr, st] = await Promise.all([ingestionService.getProposals(), ingestionService.getStatus().catch(() => null)]);
            setProposals(pr.proposals || []);
            setStatus(st);
        } catch { notify('Could not load the review queue.', 'error'); setProposals([]); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const pullNow = async () => {
        setPulling(true);
        try {
            const r = await ingestionService.runNow();
            if (r && r.authFailed) notify('Gmail auth failed — reconnect the mailbox.', 'error');
            else notify(`Pulled: ${r?.proposals ?? 0} new, ${r?.dismissed ?? 0} dropped.`, 'success');
            await load();
        } catch { notify('Pull failed.', 'error'); } finally { setPulling(false); }
    };

    const counts = useMemo(() => {
        const c = {};
        (proposals || []).forEach((p) => { const b = bucketOf(p); c[b] = (c[b] || 0) + 1; });
        return c;
    }, [proposals]);

    // A PATCH_EVENT is a reply email adding detail to something already announced. It gets the SAME full
    // card as a create — the reviewer should approve a finished item, not a three-field fragment — plus a
    // picker for which live event it updates. Candidates are fetched here rather than inside a child so
    // the card can MERGE the chosen event's existing values under the reply's new ones.
    const patchIds = useMemo(
        () => (proposals || []).filter((p) => p.mutation_type === 'PATCH_EVENT').map((p) => p.id).join(','),
        [proposals]
    );
    useEffect(() => {
        if (!patchIds) return;
        patchIds.split(',').filter(Boolean).forEach((id) => {
            ingestionService.getEventCandidates(id)
                .then((r) => setCands((c) => ({ ...c, [id]: r.candidates || [] })))
                .catch(() => setCands((c) => ({ ...c, [id]: [] })));
        });
    }, [patchIds]);

    // Picking the target fills the card in: the live event's current values show through wherever the
    // reply email said nothing, so what you approve is the merged result rather than a bare diff.
    const chooseTarget = (p, cand) => {
        setTargets((t) => ({ ...t, [p.id]: cand.id }));
        setDrafts((d) => ({ ...d, [p.id]: mergeTargetIntoDraft(draftFor(p), cand) }));
    };

    const draftFor = (p) => drafts[p.id] || {
        title: p.payload.title || '', club: p.payload.club || '', startDate: p.payload.startDate || p.payload.event_date || '',
        // The notice-only fields. They were absent from the draft entirely, which is why the review
        // card could not show a body, a kind, an audience, an importance or the external chip.
        body: p.payload.body || '', kind: p.payload.kind || '', audience: p.payload.audience || '',
        deadline_time: p.payload.deadline_time || '', priority: p.payload.priority || 'general',
        is_external: !!p.payload.is_external,
        venue: p.payload.venue || '', link: p.payload.registration_link || p.payload.link || '',
        deadline: p.payload.deadline || '', timeStart: p.payload.time_start || '', description: p.payload.description || '',
        endDate: p.payload.endDate || '', categories: Array.isArray(p.payload.categories) ? p.payload.categories : [],
        isAllDay: !p.payload.time_start,               // no extracted time → treat as all-day (admin can flip)
        // Still opportunity-vs-info on the WIRE — the merge above is about how the queue is
        // presented, not about throwing the classification away.
        type: bucketOf(p) === 'events'
            ? 'event'
            : (p.payload && p.payload.is_opportunity) ? 'opportunity' : 'info',
    };
    const setField = (id, k, v) => setDrafts((d) => ({ ...d, [id]: { ...draftFor(proposals.find((p) => p.id === id)), ...d[id], [k]: v } }));
    const withBusy = (id, on) => setBusy((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });

    const publish = async (p) => {
        withBusy(p.id, true);
        const d = draftFor(p);
        const payload = { title: d.title, club: d.club, startDate: d.startDate || null, venue: d.venue || null,
            // Notice fields ride along for every type; publishEvent ignores what it does not use.
            body: d.body || null, kind: d.kind || null, audience: d.audience || null,
            deadline_time: d.deadline_time || null, priority: d.priority || 'general',
            is_external: !!d.is_external,
            time_start: d.isAllDay ? null : (d.timeStart || null), description: d.description || null,
            endDate: d.endDate || null, categories: Array.isArray(d.categories) ? d.categories : [],
            registration_link: d.link || null, link: d.link || null, deadline: d.deadline || null,
            event_date: d.startDate || null };
        const targetId = p.mutation_type === 'PATCH_EVENT' ? targets[p.id] : null;
        try {
            if (targetId) {
                // UPDATE the live event in place — same row, so reminders students already set survive.
                // approvedType is deliberately NOT sent: it would route this into the create path and put
                // a second copy of the event on the feed while the original kept the stale date.
                await ingestionService.publishProposal(p.id, { payload, targetId });
                notify('Event updated.', 'success');
            } else {
                // approvedType lets the admin reclassify (Event/Opportunity/Info) — captured for the feedback loop.
                // A reply whose original was never published has nothing to update, so it publishes as new.
                await ingestionService.publishProposal(p.id, { payload, approvedType: d.type });
                notify('Published to the feed.', 'success');
            }
            setProposals((ps) => ps.filter((x) => x.id !== p.id));
        } catch (e) { notify(e?.response?.data?.error || 'Publish failed.', 'error'); } finally { withBusy(p.id, false); }
    };
    const dismiss = async (p) => {
        withBusy(p.id, true);
        try {
            await ingestionService.dismissProposal(p.id);
            setProposals((ps) => ps.filter((x) => x.id !== p.id));
        } catch { notify('Dismiss failed.', 'error'); } finally { withBusy(p.id, false); }
    };

    if (proposals === null) return <div className="pr-wrap card"><p className="pr-muted">Loading review queue…</p></div>;

    const all = proposals.filter((p) => bucketOf(p) === filter);
    const visible = all.slice(0, 60);   // cap DOM; reviewer works the queue down (Refresh reloads)

    return (
        <div className="pr-wrap">
            <div className="pr-head">
                <div className="pr-title"><Inbox size={18} /> <strong>Email review queue</strong> <span className="pr-count">{proposals.length}</span></div>
                <div className="pr-head-actions">
                    <button className="btn btn-yellow pr-pull" onClick={pullNow} disabled={pulling}>
                        <Download size={14} /> {pulling ? 'Pulling…' : 'Pull now'}
                    </button>
                    <button className="btn btn-outline pr-refresh" onClick={load}><RefreshCw size={14} /> Refresh</button>
                </div>
            </div>

            {status && status.gmailConfigured && status.authOk === false && (
                <div className="pr-alert"><AlertTriangle size={16} /> Gmail ingestion stopped — the sign-in token expired or was revoked. New emails aren’t being pulled.</div>
            )}

            <div className="pr-filter">
                {BUCKETS.map(([k, label]) => (
                    <button key={k} className={`pr-fbtn ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k)}>
                        {label} <span className="pr-fcount">{counts[k] || 0}</span>
                    </button>
                ))}
            </div>

            {all.length > visible.length && <p className="pr-muted pr-cap">Showing {visible.length} of {all.length} — work these down, then Refresh.</p>}

            {visible.length === 0 ? (
                <div className="pr-empty card"><Check size={18} /> Nothing to review here.</div>
            ) : visible.map((p) => {
                if (bucketOf(p) === 'calendar') {
                    return <CalendarCard key={p.id} p={p} onDone={(id) => setProposals((ps) => ps.filter((x) => x.id !== id))} />;
                }
                // A CANCELLATION stays on its own small card — it removes an event rather than describing
                // one, so the full editor would be noise. A deadline extension likewise.
                // A PATCH_EVENT falls through to the FULL card below: it is a reply email carrying the
                // detail the first mail lacked, so the reviewer should see and approve the finished item.
                if (bucketOf(p) === 'lifecycle' && p.mutation_type !== 'PATCH_EVENT') {
                    return p.mutation_type === 'PATCH_NOTICE'
                        ? <DeadlineExtensionCard key={p.id} p={p} onDone={(id) => setProposals((ps) => ps.filter((x) => x.id !== id))} />
                        : <LifecycleCard key={p.id} p={p} onDone={(id) => setProposals((ps) => ps.filter((x) => x.id !== id))} />;
                }
                const d = draftFor(p);
                const ev = p.evidence || {};
                const isUpdate = p.mutation_type === 'PATCH_EVENT';
                const isPub = PUBLISHABLE.has(filter);
                // An update is always an event — the Type selector is hidden for it, because switching an
                // event to a notice is a move between two tables, not an edit, and would strand the
                // event's id along with every reminder attached to it.
                const isEvent = isUpdate ? true : (isPub ? d.type === 'event' : filter === 'events');
                const myCands = cands[p.id];
                const target = targets[p.id];
                const working = busy.has(p.id);
                return (
                    <div key={p.id} className="pr-card card">
                        <div className="pr-card-top">
                            {/* An update modifies something already on students' screens; a create does not.
                                Same card, so the label has to carry that difference. */}
                            <span className={`pr-type t-${bucketOf(p)}`}>{isUpdate ? 'UPDATE EVENT' : p.mutation_type.replace('_', ' ')}</span>
                            {/* A deadline the app looked up in the academic calendar because the mail
                                stated none. Flagged HERE so the reviewer sees it is an inference before
                                publishing, rather than discovering it on the live card. */}
                            {p.payload && p.payload.deadline_source === 'calendar' && (
                                <span className="pr-kind" title="Derived from the academic calendar — this email stated no date">
                                    📅 date from calendar
                                </span>
                            )}
                            {p.payload.kind && <span className="pr-kind">{p.payload.kind}</span>}
                            {ev.source === 'llm'
                                ? <span className="pr-src llm" title={ev.groq?.reason || ''}><Sparkles size={12} /> AI{ev.groq?.confidence != null ? ` ${Math.round(ev.groq.confidence * 100)}%` : ''}</span>
                                : <span className="pr-src rules" title="Groq unavailable — rules-based"><Cpu size={12} /> rules</span>}
                            {ev.agreed === false && <span className="pr-flag" title={`rules said ${ev.deterministic_type}, AI said ${ev.llm_type}`}>AI changed</span>}
                            {ev.unverified_sender && <span className="pr-flag pr-unverified" title="Sender isn't a recognized club/office — double-check before publishing">⚠ unverified sender</span>}
                            {(ev.reason_codes || []).map((rc) => {
                                // A calendar conflict is not a weak-evidence hint like the others — it is
                                // two sources disagreeing about a date, and the reviewer needs the rival
                                // date itself, not a category name.
                                const conflict = /^CONFLICT_CALENDAR_SAYS_(.+)$/.exec(rc);
                                return conflict
                                    ? <span key={rc} className="pr-rc pr-rc-conflict" title="The email states a different date from the academic calendar. Neither was assumed correct — the email's date is used; check which is right.">⚠ calendar says {conflict[1]}</span>
                                    : <span key={rc} className="pr-rc">{rc.replace(/^WEAK_|^AMBIG_/, '').toLowerCase()}</span>;
                            })}
                        </div>

                        <input className="pr-input pr-title-in" value={d.title} onChange={(e) => setField(p.id, 'title', e.target.value)} placeholder="Title" />

                        {p.payload.poster_url && (
                            <a className="pr-poster" href={p.payload.poster_url} target="_blank" rel="noreferrer" title="Open full poster">
                                <img src={p.payload.poster_url} alt="event poster" loading="lazy" />
                            </a>
                        )}

                        {(isEvent || (isPub && isSuperAdmin && p.payload._from)) && (
                            <div className="pr-optbar">
                                {isEvent && (
                                    <label className="pr-toggle" title="On when the email states no time; toggle off to set a start time">
                                        <input type="checkbox" checked={!!d.isAllDay} onChange={(e) => setField(p.id, 'isAllDay', e.target.checked)} />
                                        <span className="pr-toggle-track"><span className="pr-toggle-thumb" /></span>
                                        <span className="pr-toggle-label">All-day event</span>
                                    </label>
                                )}
                                {isPub && isSuperAdmin && p.payload._from && (
                                    <button type="button" className="pr-rule-trigger" onClick={() => setRuleFor(ruleFor === p.id ? null : p.id)}>
                                        ⚙ {ruleFor === p.id ? 'close rule' : 'save as rule'}
                                    </button>
                                )}
                            </div>
                        )}

                        <div className="pr-fields">
                            {isPub && (
                                <label className="pr-field"><span>Type</span>
                                    <select className="pr-input" value={d.type} onChange={(e) => setField(p.id, 'type', e.target.value)}>
                                        <option value="event">Event</option>
                                        <option value="opportunity">Opportunity</option>
                                        <option value="info">Info</option>
                                    </select>
                                </label>
                            )}
                            {/* A NOTICE gets the very same field set as the Edit Notice screen —
                                title aside, which is the headline input above. It used to get a subset
                                with no body, so a notice was approved without anyone seeing the text a
                                student would read; the body could only be fixed after publishing. The
                                draft speaks camelCase, the notice speaks its own column names, so the
                                two are mapped here rather than in the shared component. */}
                            {!isEvent && filter !== 'calendar' ? (
                                <NoticeFields
                                    omit={['title']}
                                    clubs={clubs}
                                    value={{
                                        ...d,
                                        event_date: d.startDate || '',
                                        time_start: d.timeStart || '',
                                        club_id: (clubs.find((c) => c.name === d.club) || {}).id ?? '',
                                    }}
                                    onChange={(k, v) => {
                                        if (k === 'event_date') return setField(p.id, 'startDate', v);
                                        if (k === 'time_start') return setField(p.id, 'timeStart', v);
                                        // publish() sends a club NAME, resolved server-side, so keep the
                                        // draft in names and let the dropdown speak ids.
                                        if (k === 'club_id') {
                                            const hit = clubs.find((c) => String(c.id) === String(v));
                                            return setField(p.id, 'club', hit ? hit.name : '');
                                        }
                                        return setField(p.id, k, v);
                                    }}
                                />
                            ) : (
                              <>
                            {filter !== 'calendar' && <label className="pr-field"><span>Club</span><input className="pr-input" value={d.club} placeholder="Institute" onChange={(e) => setField(p.id, 'club', e.target.value)} /></label>}
                            <label className="pr-field"><span>{isEvent || filter === 'calendar' ? 'Date' : 'Happens on'}</span><input type="date" className="pr-input" value={d.startDate || ''} onChange={(e) => setField(p.id, 'startDate', e.target.value)} /></label>
                            {isEvent && <label className="pr-field"><span>End date <span className="pr-hint">multi-day</span></span><input type="date" className="pr-input" min={d.startDate || undefined} value={d.endDate || ''} onChange={(e) => setField(p.id, 'endDate', e.target.value)} /></label>}
                            {(isEvent ? !d.isAllDay : filter !== 'calendar') && <label className="pr-field"><span>Time</span><input type="time" className="pr-input" value={d.timeStart} onChange={(e) => setField(p.id, 'timeStart', e.target.value)} /></label>}
                            {filter !== 'calendar' && <label className="pr-field"><span>Venue</span><input className="pr-input" value={d.venue} onChange={(e) => setField(p.id, 'venue', e.target.value)} placeholder="TBA" /></label>}
                            <label className="pr-field pr-wide"><span>Link</span><input className="pr-input" value={d.link} onChange={(e) => setField(p.id, 'link', e.target.value)} placeholder="registration / info link" /></label>
                            {isEvent && <label className="pr-field pr-wide"><span>Description</span><textarea className="pr-input pr-desc" rows={2} value={d.description} onChange={(e) => setField(p.id, 'description', e.target.value)} placeholder="(optional — no date/time/venue; those are fields above)" /></label>}
                              </>
                            )}
                            {isEvent && allCats.length > 0 && (
                                <div className="pr-field pr-wide">
                                    <span>Categories</span>
                                    <div className="pr-cats">
                                        {allCats.map((c) => {
                                            const on = (d.categories || []).includes(c.name);
                                            return (
                                                <button
                                                    type="button"
                                                    key={c.id ?? c.name}
                                                    className={`pr-cat${on ? ' active' : ''}`}
                                                    onClick={() => setField(p.id, 'categories', on
                                                        ? (d.categories || []).filter((n) => n !== c.name)
                                                        : [...(d.categories || []), c.name])}
                                                >
                                                    {c.name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>

                        {ruleFor === p.id && isSuperAdmin && (
                            <RuleForm p={p} defaultType={d.type === 'info' ? 'notice' : d.type} onClose={() => setRuleFor(null)} />
                        )}

                        <div className="pr-meta">
                            {p.payload._from && <span>{p.payload._from.replace(/<.*/, '').trim()}</span>}
                            {p.payload._supersedes_message_id && <span className="pr-supersedes">updates a prior item</span>}
                        </div>

                        {isUpdate && (
                            <div className="pr-cal-choice">
                                <div className="pr-cal-label">Update which live event:</div>
                                {myCands === undefined ? <span className="pr-muted pr-cal-opt">finding matches…</span>
                                    : myCands.length === 0
                                        ? <span className="pr-muted pr-cal-opt">
                                            Nothing live matches this yet — publishing will add it as a new event.
                                        </span>
                                        : myCands.map((c) => (
                                            <label key={c.id} className="pr-cal-opt">
                                                <input type="radio" name={`t-${p.id}`} checked={target === c.id} onChange={() => chooseTarget(p, c)} />
                                                {' '}<strong>{(c.name || '').slice(0, 46)}</strong>{' '}
                                                <span className="pr-muted">({c.start ? new Date(c.start).toLocaleDateString() : 'TBD'})</span>
                                            </label>
                                        ))}
                                {target && <p className="pr-hint">Fields above show the merged result. Saving edits this event in place, so reminders students already set still work.</p>}
                            </div>
                        )}

                        <div className="pr-actions">
                            {(isPub || isUpdate)
                                ? (
                                    <button className="btn btn-yellow pr-pub" disabled={working || !d.title} onClick={() => publish(p)}>
                                        <Send size={14} /> {isUpdate ? (target ? 'Apply update' : 'Publish as new event') : 'Publish'}
                                    </button>
                                )
                                : <span className="pr-note">{filter === 'calendar' ? 'Handle via Academic Calendar' : 'Apply update manually'}</span>}
                            <button className="btn btn-outline pr-dis" disabled={working} onClick={() => dismiss(p)}><X size={14} /> Dismiss</button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
