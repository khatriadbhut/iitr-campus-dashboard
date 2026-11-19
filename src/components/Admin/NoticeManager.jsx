import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, RefreshCw, Search, AlertTriangle, Edit, X, Loader, Plus } from 'lucide-react';
import ingestionService from '../../services/ingestion';
import clubsService from '../../services/clubs';
import { notify } from '../../services/notify';
import NoticeFields from './NoticeFields';
import './ProposalReviewManager.css';

// Notices were write-once — published from the review queue and then frozen, while events had edit and
// delete. Anything baked in at publish time (a dropped apply-by, a club that fell back to Institute, a
// long-expired item) had no route to correction. This is that route.
//
// Presented as a TABLE with an edit modal, matching Manage Events and Manage Clubs. It used to be a
// column of always-open inline forms — every field of every notice on screen at once — which looked
// nothing like the rest of the admin area and turned "which notices are expired" into a scroll.

// Filter by what a REVIEWER needs to find, not by the pipeline's own sub-categorisation. Opportunity
// vs info is still shown per row; it just isn't how the list is sliced, because "is this an
// opportunity" is rarely the question being asked when correcting notices.
const BUCKETS = [['all', 'All'], ['important', 'Important'], ['external', 'External'], ['expired', 'Expired']];
const todayStr = () => new Date().toLocaleDateString('en-CA');   // local YYYY-MM-DD, not UTC
const isExpired = (n) => !n.open_ended && !!n.deadline && n.deadline < todayStr();

// Only the fields a human realistically corrects. Provenance (source, published_at) stays read-only.
//
// One component for both writing a new notice and correcting a live one. `n` is the notice being
// edited, or null to post a new one. They are the same form over the same field set, and splitting
// them into two components is exactly how the review card and the edit modal drifted apart before —
// see NoticeFields.jsx. The only real differences are where the values are read from (a live notice
// vs an empty draft) and which service call the submit makes.
function NoticeModal({ n, onClose, onSaved }) {
    const creating = !n;
    const base = n || {};
    const [draft, setDraft] = useState({});
    const [busy, setBusy] = useState(false);
    // The club roster, for the one field the pipeline most often gets wrong. A notice relayed through a
    // gensec address arrives with no club at all unless the organiser is named in the subject or the
    // sign-off, and until now there was nowhere in the app to correct that — not here, not in review.
    // It is not cosmetic: club_id is what "hide clubs I don't follow" tests against, so a notice with
    // the wrong club (or none) ignores that preference entirely.
    const [clubs, setClubs] = useState([]);
    useEffect(() => { clubsService.getAllClubs().then(setClubs).catch(() => setClubs([])); }, []);

    const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));

    const changed = (k) => (typeof draft[k] === 'boolean' ? draft[k] !== !!base[k] : String(draft[k] ?? '') !== String(base[k] ?? ''));
    // A new notice needs a title and nothing else; an edit needs at least one real change. Without the
    // title guard the server's 400 would be the first sign that the one required field was blank.
    const title = String(draft.title ?? base.title ?? '').trim();
    const submittable = creating ? !!title : Object.keys(draft).some(changed);

    const save = async (e) => {
        e.preventDefault();
        const body = {};
        for (const k of Object.keys(draft)) if (changed(k)) body[k] = draft[k];
        // Blanks are meaningless on a CREATE — an untouched date field would post `deadline: ''` and be
        // stored as "no deadline" either way, so drop them and let the column defaults stand. On an edit
        // a blank is meaningful: it is how you clear a field the pipeline got wrong.
        if (creating) for (const k of Object.keys(body)) if (body[k] === '' || body[k] === null) delete body[k];
        if (!Object.keys(body).length) { onClose(); return; }
        setBusy(true);
        try {
            const r = creating
                ? await ingestionService.createNotice(body)
                : await ingestionService.updateNotice(n.id, body);
            notify(creating ? 'Notice posted.' : 'Notice updated.', 'success');
            onSaved(r.notice || { ...base, ...body });
            onClose();
        } catch (err) {
            notify(err?.response?.data?.error || (creating ? 'Could not post notice.' : 'Update failed.'), 'error');
        } finally { setBusy(false); }
    };

    // PORTALLED to <body>. The modal was rendered inside the notices panel, which sits in a card with
    // an .animate-fade-in transform — a transformed ancestor becomes the containing block for
    // position:fixed, so the overlay stopped covering the viewport and appeared pinned inside the list
    // it was supposed to sit above. A portal removes the dependency on where it happens to be mounted.
    return createPortal((
        <div className="modal-overlay animate-fade-in">
            <div className="modal-content card">
                <div className="modal-header">
                    <h2>{creating ? 'Post New Notice' : `Edit Notice #${n.id}`}</h2>
                    <button className="btn-icon" onClick={onClose}><X size={20} /></button>
                </div>
                <form onSubmit={save} className="event-form">
                    <div className="pr-fields">
                        {/* Every notice field, shared with the review card so the two can never drift.
                            See NoticeFields.jsx — the review card used to show a subset, which meant a
                            notice was approved without its body ever being seen. */}
                        <NoticeFields
                            value={{ ...base, ...draft }}
                            onChange={set}
                            deadlineSource={base.deadline_source}
                            clubs={clubs}
                        />
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
                        <button type="submit" className="btn btn-yellow" disabled={busy || !submittable}>
                            {busy ? <Loader size={16} className="animate-spin" /> : (creating ? 'Publish Notice' : 'Save Changes')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    ), document.body);
}

export default function NoticeManager() {
    const [notices, setNotices] = useState(null);
    const [filter, setFilter] = useState('all');
    const [q, setQ] = useState('');
    const [editing, setEditing] = useState(null);
    const [creating, setCreating] = useState(false);
    const [confirming, setConfirming] = useState(null);   // id awaiting delete confirmation

    const load = useCallback(() => {
        ingestionService.getNotices()
            .then((d) => setNotices(d.notices || []))
            .catch(() => { notify('Could not load notices.', 'error'); setNotices([]); });
    }, []);
    useEffect(() => { load(); }, [load]);

    const counts = useMemo(() => {
        const c = { all: 0, important: 0, external: 0, expired: 0 };
        for (const n of notices || []) {
            c.all++;
            if (n.priority === 'important') c.important++;
            if (n.is_external) c.external++;
            if (isExpired(n)) c.expired++;
        }
        return c;
    }, [notices]);

    const visible = useMemo(() => {
        let list = notices || [];
        if (filter === 'expired') list = list.filter(isExpired);
        else if (filter === 'important') list = list.filter((n) => n.priority === 'important');
        else if (filter === 'external') list = list.filter((n) => !!n.is_external);
        const term = q.trim().toLowerCase();
        if (term) list = list.filter((n) => `${n.title} ${n.body || ''} ${n.kind || ''}`.toLowerCase().includes(term));
        return list;
    }, [notices, filter, q]);

    // Deliberately NOT window.confirm: it is suppressed outright in the Playwright/CDP browser used for
    // smoke tests, and blocked by popup blockers, some extensions and PWA standalone mode — the button
    // then silently does nothing with no error anywhere. Two-step inline confirm works everywhere.
    const del = async (id) => {
        try {
            await ingestionService.deleteNotice(id);
            notify('Notice deleted.', 'success');
            setNotices((list) => list.filter((x) => String(x.id) !== String(id)));
        } catch (e) {
            notify(e?.response?.data?.error || 'Delete failed.', 'error');
        } finally { setConfirming(null); }
    };

    if (notices === null) return <div className="pr-wrap"><p className="pr-muted">Loading notices…</p></div>;

    return (
        <div className="pr-wrap">
            <div className="admin-locations-header">
                <h3>Notice Management</h3>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    {/* Every notice used to have to arrive as an email. This is the only way to add one
                        that was never mailed to students-notices — or whose mail the pipeline dropped. */}
                    <button className="btn btn-yellow" onClick={() => setCreating(true)}>
                        <Plus size={15} /> Post New Notice
                    </button>
                    <button className="pr-refresh" onClick={load}><RefreshCw size={15} /> Refresh</button>
                </div>
            </div>

            <div className="pr-filter">
                {BUCKETS.map(([k, label]) => (
                    <button key={k} className={filter === k ? 'pr-fbtn active' : 'pr-fbtn'} onClick={() => setFilter(k)}>
                        {label} <span className="pr-fcount">{counts[k] ?? 0}</span>
                    </button>
                ))}
                <label className="pr-rule-row" style={{ marginLeft: 'auto' }}>
                    <Search size={14} />
                    <input className="pr-input" placeholder="search title / body" value={q} onChange={(e) => setQ(e.target.value)} />
                </label>
            </div>

            {filter === 'expired' && counts.expired > 0 && (
                <p className="pr-hint">
                    Apply-by date has passed. These stay in the feed until removed — an open-ended notice is never counted here.
                </p>
            )}

            {!visible.length ? <p className="pr-empty">Nothing here.</p> : (
                <div style={{ overflowX: 'auto' }}>
                    <table className="admin-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--grey-200)', background: 'var(--brand-purple-pale)' }}>
                                <th style={{ padding: '0.85rem', fontWeight: 600 }}>Title</th>
                                <th style={{ padding: '0.85rem', fontWeight: 600 }}>Kind</th>
                                <th style={{ padding: '0.85rem', fontWeight: 600 }}>Apply by</th>
                                <th style={{ padding: '0.85rem', fontWeight: 600 }}>Flags</th>
                                <th style={{ padding: '0.85rem', fontWeight: 600 }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map((n) => (
                                <tr key={n.id} style={{ borderBottom: '1px solid var(--grey-100)' }}>
                                    <td style={{ padding: '0.85rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                        {n.title}
                                        {n.club_name && <span className="pr-src" style={{ marginLeft: 8 }}>{n.club_name}</span>}
                                    </td>
                                    <td style={{ padding: '0.85rem', color: 'var(--text-secondary)' }}>{n.kind || '—'}</td>
                                    <td style={{ padding: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {n.deadline || '—'}
                                        {isExpired(n) && <span className="pr-flag" style={{ marginLeft: 6 }}>expired</span>}
                                    </td>
                                    <td style={{ padding: '0.85rem' }}>
                                        {n.priority === 'important' && <span className="pr-flag pr-flag-important">important</span>}
                                        {n.is_external && <span className="pr-kind" style={{ marginLeft: 6 }}>external</span>}
                                        {n.priority !== 'important' && !n.is_external && <span className="pr-muted">—</span>}
                                    </td>
                                    <td style={{ padding: '0.85rem', whiteSpace: 'nowrap' }}>
                                        <button className="btn-icon" style={{ display: 'inline-flex', marginRight: '0.5rem', color: 'var(--grey-500)' }}
                                            onClick={() => setEditing(n)} title="Edit notice">
                                            <Edit size={16} />
                                        </button>
                                        {confirming === n.id ? (
                                            <>
                                                <button className="pr-dis" onClick={() => del(n.id)}>
                                                    <AlertTriangle size={14} /> Really delete?
                                                </button>
                                                <button className="pr-fbtn" style={{ marginLeft: 6 }} onClick={() => setConfirming(null)}>Cancel</button>
                                            </>
                                        ) : (
                                            <button className="btn-icon" style={{ display: 'inline-flex', color: 'var(--red, #c62828)' }}
                                                onClick={() => setConfirming(n.id)} title="Delete notice">
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {editing && (
                <NoticeModal
                    n={editing}
                    onClose={() => setEditing(null)}
                    onSaved={(upd) => setNotices((list) => list.map((x) => (x.id === upd.id ? { ...x, ...upd } : x)))}
                />
            )}

            {creating && (
                <NoticeModal
                    n={null}
                    onClose={() => setCreating(false)}
                    // Prepended, not appended: the table renders whatever order the feed returns, and a
                    // notice you just wrote is the one you want to see without hunting for it.
                    onSaved={(made) => setNotices((list) => [made, ...(list || [])])}
                />
            )}
        </div>
    );
}
