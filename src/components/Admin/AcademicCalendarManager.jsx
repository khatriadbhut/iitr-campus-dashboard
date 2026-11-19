import React, { useState, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSWRConfig } from 'swr';
import { Upload, AlertTriangle, ChevronLeft, ChevronRight, RotateCcw, X, CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import academicCalendarService from '../../services/academicCalendar';
import { notify } from '../../services/notify';
import './AcademicCalendarManager.css';

const CATEGORIES = ['Academic', 'Exam', 'Holiday', 'Fest', 'Timetable Reschedule'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Cell/row tints match the live Calendar (src/pages/Calendar.css): holidays &
// weekends get a green tint, exams a red tint. Fully data-driven off categories +
// day-of-week, so it works for any uploaded calendar.
const HOLIDAY_TINT = '#ecfdf5';
const EXAM_TINT = '#fee2e2';
const rowTint = (e) => ((e.isHoliday || e.category === 'Holiday') ? HOLIDAY_TINT : (e.category === 'Exam' ? EXAM_TINT : undefined));

const parseYMD = (s) => {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return { y, m: m - 1, d };
};
const inRange = (cellKey, start, end) => {
    if (!start) return false;
    return cellKey >= start && cellKey <= (end || start);
};
const keyOf = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const fmt = (s) => {
    const p = parseYMD(s);
    return p ? `${MONTHS_SHORT[p.m]} ${p.d}, ${p.y}` : '';
};

// ── re-upload diff: compare a freshly parsed calendar against the one currently
// published for the same semester, so the admin sees exactly what a re-upload
// would change before committing. Purely additive & frontend-only — never blocks
// the preview. Only *changed* rows get a marker; unchanged rows stay untouched.
const normTitle = (t) => (t || '').toLowerCase().replace(/\s+/g, ' ').trim();
const effEnd = (e) => e.endDate || e.startDate || null;
const sameDates = (a, b) => (a.startDate || null) === (b.startDate || null) && effEnd(a) === effEnd(b);
const byStart = (a, b) => (a.startDate || '').localeCompare(b.startDate || '');
// Strip the transient diff-only fields before anything is published or restored.
const stripMeta = ({ _change, _movedFrom, _used, ...rest }) => rest;

// Match parsed↔live entries by normalized title; same-title rows are paired in
// date order so multi-range splits line up. Returns parsed entries annotated with
// `_change` ('added' | 'moved' | 'unchanged') and the live rows that disappeared.
function computeDiff(parsed, live) {
    const liveByTitle = new Map();
    for (const l of live) {
        const k = normTitle(l.title);
        if (!liveByTitle.has(k)) liveByTitle.set(k, []);
        liveByTitle.get(k).push({ ...l, _used: false });
    }
    for (const arr of liveByTitle.values()) arr.sort(byStart);

    const parsedByTitle = new Map();
    parsed.forEach((p, idx) => {
        const k = normTitle(p.title);
        if (!parsedByTitle.has(k)) parsedByTitle.set(k, []);
        parsedByTitle.get(k).push(idx);
    });

    const annotated = parsed.map((e) => ({ ...e }));
    let added = 0, moved = 0, unchanged = 0;
    for (const [k, idxs] of parsedByTitle) {
        const bucket = liveByTitle.get(k) || [];
        const sorted = idxs.slice().sort((a, b) => byStart(parsed[a], parsed[b]));
        sorted.forEach((idx, i) => {
            const match = bucket[i];
            if (!match) { annotated[idx]._change = 'added'; added++; return; }
            match._used = true;
            if (sameDates(parsed[idx], match)) { annotated[idx]._change = 'unchanged'; unchanged++; }
            else { annotated[idx]._change = 'moved'; annotated[idx]._movedFrom = { startDate: match.startDate, endDate: effEnd(match) }; moved++; }
        });
    }

    const removed = [];
    for (const arr of liveByTitle.values()) for (const l of arr) if (!l._used) removed.push(l);
    return { annotated, removed, counts: { added, moved, removed: removed.length, unchanged } };
}

export default function AcademicCalendarManager() {
    const { mutate } = useSWRConfig();
    const [loading, setLoading] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [report, setReport] = useState(null);
    const [status, setStatus] = useState(null);
    const [entries, setEntries] = useState([]);
    const [semester, setSemester] = useState('');
    const [cursor, setCursor] = useState(null);
    const [editingIdx, setEditingIdx] = useState(null);
    const [imports, setImports] = useState(null);
    // Re-upload diff vs the currently-published same-semester calendar (upload only).
    const [diff, setDiff] = useState(null);
    const [removedEntries, setRemovedEntries] = useState([]);
    const fileRef = useRef(null);
    // 'grid' = month calendar, 'agenda' = list. Default to list on small screens.
    const [view, setView] = useState(() => (typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches ? 'agenda' : 'grid'));

    const attention = useMemo(
        () => entries.map((e, i) => ({ e, i })).filter(({ e }) => e.tentative || !e.startDate),
        [entries]
    );

    // agenda (mobile): all events sorted by date, TBD rows first (they need attention)
    const agenda = useMemo(
        () => entries.map((e, i) => ({ e, i })).sort((a, b) => {
            const da = a.e.startDate || '0000', db = b.e.startDate || '0000';
            return da < db ? -1 : da > db ? 1 : 0;
        }),
        [entries]
    );

    const reset = () => { setReport(null); setStatus(null); setEntries([]); setEditingIdx(null); setSemester(''); setCursor(null); setDiff(null); setRemovedEntries([]); };

    const onFile = async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!file) return;
        setLoading(true); reset();
        try {
            const rep = await academicCalendarService.previewImport(file);
            if (rep.status === 'ok') {
                const parsed = rep.entries.map((e) => ({ ...e }));
                const sem = (rep.meta && rep.meta.semester) || '';
                // Diff against the same semester's published calendar (if any). Needs a
                // detected semester to compare like-for-like; otherwise skip silently.
                let entriesToShow = parsed;
                if (sem) {
                    let baseline = false, counts = { added: 0, moved: 0, removed: 0, unchanged: 0 };
                    try {
                        const live = await academicCalendarService.getCurrentForEdit(sem);
                        if (live && Array.isArray(live.entries) && live.entries.length) {
                            baseline = true;
                            const d = computeDiff(parsed, live.entries);
                            entriesToShow = d.annotated; counts = d.counts;
                            setRemovedEntries(d.removed);
                        }
                    } catch (_) { /* 404 / error → treat as the first version, no diff */ }
                    setDiff({ baseline, semester: sem, counts });
                }
                setReport(rep);
                setEntries(entriesToShow);
                setSemester(sem);
                const first = entriesToShow.find((e) => e.startDate);
                setCursor(first ? { y: parseYMD(first.startDate).y, m: parseYMD(first.startDate).m } : null);
            } else {
                setStatus(rep);
            }
        } catch (err) {
            const code = err.response && err.response.status;
            if (code === 401 || code === 403) notify('Your session expired or you lack permission. Please log in again.', 'error');
            else notify('Could not read that file. Please try again.', 'error');
        } finally {
            setLoading(false);
        }
    };

    // Load the currently-published calendar into the editor (no PDF) for quick fixes.
    const editCurrent = async () => {
        setLoading(true); reset();
        try {
            const cur = await academicCalendarService.getCurrentForEdit();
            const es = cur.entries.map((e) => ({ ...e }));
            setReport({
                status: 'ok', editMode: true, filename: null, entries: es, flags: [], warnings: [],
                meta: { semester: cur.semester, program: cur.program, institution: cur.institution },
                coverage: { semester: cur.semester, program: cur.program, institution: cur.institution, total: es.length, holidays: es.filter((e) => e.isHoliday).length, tentative: es.filter((e) => e.tentative).length, flagged: 0 },
            });
            setEntries(es);
            setSemester(cur.semester || '');
            const firstDated = cur.entries.find((e) => e.startDate);
            setCursor(firstDated ? { y: parseYMD(firstDated.startDate).y, m: parseYMD(firstDated.startDate).m } : null);
        } catch (err) {
            if (err.response && err.response.status === 404) notify('No calendar has been published yet — upload a PDF first.', 'warning');
            else notify('Could not load the current calendar.', 'error');
        } finally {
            setLoading(false);
        }
    };

    const weeks = useMemo(() => {
        if (!cursor) return [];
        const first = new Date(cursor.y, cursor.m, 1);
        const startOffset = (first.getDay() + 6) % 7;
        const gridStart = new Date(cursor.y, cursor.m, 1 - startOffset);
        const out = [];
        for (let w = 0; w < 6; w++) {
            const row = [];
            for (let d = 0; d < 7; d++) {
                const day = new Date(gridStart);
                day.setDate(gridStart.getDate() + w * 7 + d);
                row.push(day);
            }
            out.push(row);
        }
        return out;
    }, [cursor]);

    const eventsOn = useCallback((day) => {
        const k = keyOf(day.getFullYear(), day.getMonth(), day.getDate());
        return entries.map((e, i) => ({ e, i })).filter(({ e }) => inRange(k, e.startDate, e.endDate));
    }, [entries]);

    const updateEntry = (idx, patch) => setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));

    const addEntry = (dateStr) => {
        const newIdx = entries.length;
        setEntries((prev) => [...prev, {
            title: 'New event', category: 'Academic',
            startDate: dateStr || null, endDate: dateStr || null,
            description: '', isHoliday: false, tentative: !dateStr,
        }]);
        setEditingIdx(newIdx);
    };
    const deleteEntry = (idx) => { setEntries((prev) => prev.filter((_, i) => i !== idx)); setEditingIdx(null); };

    // "Keep" an event the re-upload dropped: add it back to the calendar and take
    // it off the removed list so the admin doesn't silently lose it.
    const restoreRemoved = (ri) => {
        const item = removedEntries[ri];
        if (!item) return;
        setEntries((prev) => [...prev, stripMeta(item)]);
        setRemovedEntries((prev) => prev.filter((_, i) => i !== ri));
        setDiff((d) => (d ? { ...d, counts: { ...d.counts, removed: Math.max(0, d.counts.removed - 1) } } : d));
        if (item.startDate) setCursor({ y: parseYMD(item.startDate).y, m: parseYMD(item.startDate).m });
    };

    const publish = async () => {
        if (!semester.trim()) { notify('Please set the semester before publishing.', 'warning'); return; }
        setPublishing(true);
        try {
            await academicCalendarService.commitImport({
                institution: (report.meta && report.meta.institution) || 'IITR',
                program: (report.meta && report.meta.program) || 'general',
                semester: semester.trim(),
                entries: entries.map(stripMeta),
                coverage: report.coverage,
                filename: report.filename,
            });
            notify(`Academic calendar for ${semester} published successfully!`, 'success');
            mutate((key) => typeof key === 'string' && (key.includes('cal') || key.includes('academic')));
            reset();
        } catch (err) {
            notify('Failed to publish: ' + ((err.response && err.response.data && err.response.data.message) || err.message), 'error');
        } finally {
            setPublishing(false);
        }
    };

    const loadImports = async () => {
        try { setImports(await academicCalendarService.getImports()); }
        catch (err) { notify('Could not load import history.', 'error'); }
    };
    const doRollback = async (id) => {
        try {
            await academicCalendarService.rollback(id);
            notify('Reverted to the previous version.', 'success');
            mutate((key) => typeof key === 'string' && (key.includes('cal') || key.includes('academic')));
            loadImports();
        } catch (err) {
            notify('Rollback failed: ' + ((err.response && err.response.data && err.response.data.message) || err.message), 'error');
        }
    };

    const jumpTo = (i) => { setEditingIdx(i); const e = entries[i]; if (e && e.startDate) setCursor({ y: parseYMD(e.startDate).y, m: parseYMD(e.startDate).m }); };

    return (
        <div className="acal">
            <div className="acal-head">
                <div>
                    <h3>Academic Calendar</h3>
                    <p className="acal-sub">Upload the official IIT Roorkee (non-MBA) academic calendar PDF. You'll preview it before anything goes live.</p>
                </div>
                <div className="acal-head-actions">
                    <button className="btn btn-outline" onClick={editCurrent} disabled={loading}>
                        <Pencil size={15} /> Edit current
                    </button>
                    <button className="btn btn-outline" onClick={() => (imports === null ? loadImports() : setImports(null))}>
                        <RotateCcw size={15} /> Version history
                    </button>
                </div>
            </div>

            {imports !== null && (
                <div className="acal-imports card">
                    <div className="acal-imports-head"><strong>Recent imports</strong><button className="acal-x" onClick={() => setImports(null)}><X size={16} /></button></div>
                    {imports.length === 0 && <p className="acal-muted">No imports yet.</p>}
                    {imports.map((im) => (
                        <div key={im.id} className={`acal-import-row ${im.status}`}>
                            <span className="acal-import-sem">{im.semester}</span>
                            <span className={`acal-badge ${im.status}`}>{im.status}</span>
                            <span className="acal-muted">{new Date(im.created_at).toLocaleString()}</span>
                            {im.status === 'superseded' && <button className="btn btn-sm btn-outline" onClick={() => doRollback(im.id)}>Revert to this</button>}
                        </div>
                    ))}
                </div>
            )}

            {!report && !status && (
                <div
                    className={`acal-drop ${loading ? 'busy' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => !loading && fileRef.current && fileRef.current.click()}
                    onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !loading && fileRef.current) fileRef.current.click(); }}
                >
                    <Upload size={28} />
                    <span>{loading ? 'Reading the PDF…' : 'Click to choose a calendar PDF'}</span>
                    <input ref={fileRef} type="file" accept="application/pdf,.pdf" onChange={onFile} style={{ display: 'none' }} />
                </div>
            )}

            {status && (
                <div className={`acal-status card ${status.status}`}>
                    <AlertTriangle size={22} />
                    <p>{status.message}</p>
                    <button className="btn btn-outline" onClick={reset}>Choose another file</button>
                </div>
            )}

            {/* ── FULL-SCREEN PREVIEW MODAL (portaled to body so `fixed` escapes ancestors) ── */}
            {report && createPortal(
                <div className="acal-modal-overlay">
                    <div className="acal-modal">
                        <div className="acal-modal-head">
                            <div className="acal-summary-main">
                                {report.editMode && <span className="acal-chip edit">✎ Editing published</span>}
                                <label className="acal-sem">Semester
                                    <input value={semester} onChange={(e) => setSemester(e.target.value)} placeholder="e.g. Autumn 2026-27" />
                                </label>
                                <span className="acal-chip">{entries.length} events</span>
                                <span className="acal-chip holiday">{entries.filter((e) => e.isHoliday).length} holidays</span>
                                {attention.length > 0 && <span className="acal-chip warn">{attention.length} need attention</span>}
                            </div>
                            <div className="acal-head-right">
                                <div className="acal-viewtoggle">
                                    <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>Calendar</button>
                                    <button className={view === 'agenda' ? 'active' : ''} onClick={() => setView('agenda')}>List</button>
                                </div>
                                <button className="acal-x" onClick={reset} aria-label="Close preview"><X size={20} /></button>
                            </div>
                        </div>

                        {report.warnings && report.warnings.length > 0 && (
                            <div className="acal-warnbar"><AlertTriangle size={15} /> {report.warnings.join('  ·  ')}</div>
                        )}

                        {diff && (diff.baseline ? (
                            (diff.counts.added + diff.counts.moved + diff.counts.removed) > 0 ? (
                                <div className="acal-diffbar">
                                    <span className="acal-diff-label">Compared with the published {diff.semester}:</span>
                                    {diff.counts.added > 0 && <span className="acal-dtag add">🟢 {diff.counts.added} added</span>}
                                    {diff.counts.moved > 0 && <span className="acal-dtag moved">🟠 {diff.counts.moved} moved</span>}
                                    {diff.counts.removed > 0 && <span className="acal-dtag removed">🔴 {diff.counts.removed} removed</span>}
                                </div>
                            ) : (
                                <div className="acal-diffbar subtle">Identical to the published {diff.semester} calendar — nothing would change.</div>
                            )
                        ) : (
                            <div className="acal-diffbar subtle">No published {diff.semester} calendar yet — this will be the first version.</div>
                        ))}

                        <div className={`acal-modal-body view-${view}`}>
                            {/* month grid */}
                            <div className="acal-cal">
                                <div className="acal-cal-head">
                                    <button className="acal-nav" onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))}><ChevronLeft size={18} /></button>
                                    <strong>{cursor ? `${MONTHS[cursor.m]} ${cursor.y}` : ''}</strong>
                                    <button className="acal-nav" onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))}><ChevronRight size={18} /></button>
                                </div>
                                <div className="acal-grid acal-grid-head">{WEEKDAYS.map((d) => <div key={d} className="acal-wd">{d}</div>)}</div>
                                {weeks.map((row, wi) => (
                                    <div className="acal-grid" key={wi}>
                                        {row.map((day, di) => {
                                            const outside = day.getMonth() !== cursor.m;
                                            const dateKey = keyOf(day.getFullYear(), day.getMonth(), day.getDate());
                                            const evs = eventsOn(day);
                                            // Original Calendar.jsx logic: Sun always off; Sat off unless it's a
                                            // reschedule (working Saturday); holiday/weekend → green, exam → red.
                                            const dayCats = new Set(evs.map(({ e }) => e.category));
                                            const dow = day.getDay();
                                            const isRescheduled = dayCats.has('Timetable Reschedule');
                                            const isWeekend = dow === 0 || (dow === 6 && !isRescheduled);
                                            const isExam = dayCats.has('Exam');
                                            const isHoliday = !isExam && (dayCats.has('Holiday') || isWeekend);
                                            return (
                                                <div key={di} className={`acal-cell ${outside ? 'outside' : ''} ${isExam ? 'exam' : ''} ${isHoliday ? 'holiday' : ''}`} title="Click to add an event on this day" onClick={() => !outside && addEntry(dateKey)}>
                                                    <span className="acal-daynum">{day.getDate()}</span>
                                                    {evs.slice(0, 3).map(({ e, i }) => (
                                                        <button key={i} className={`acal-ev ${e.tentative ? 'tentative' : ''} ${e._change === 'added' ? 'chg-add' : ''} ${e._change === 'moved' ? 'chg-moved' : ''}`} title={e._change === 'moved' && e._movedFrom ? `Moved from ${fmt(e._movedFrom.startDate)}` : e.title} onClick={(ev) => { ev.stopPropagation(); setEditingIdx(i); }}>
                                                            {e._change === 'added' && '🟢 '}{e._change === 'moved' && '🟠 '}{e.tentative && '🟡 '}{e.title}
                                                        </button>
                                                    ))}
                                                    {evs.length > 3 && <span className="acal-more">+{evs.length - 3}</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>

                            {/* DESKTOP: attention side list */}
                            <div className="acal-side">
                                <strong>Needs attention</strong>
                                {attention.length === 0 && <p className="acal-muted">Everything parsed cleanly. 🎉</p>}
                                {attention.map(({ e, i }) => (
                                    <button key={i} className="acal-att" onClick={() => jumpTo(i)}>
                                        <span className="acal-att-title">{e.startDate ? '🟡' : '⚠️'} {e.title}</span>
                                        <span className="acal-att-date">{e.startDate ? fmt(e.startDate) : 'date not set'}</span>
                                    </button>
                                ))}

                                {removedEntries.length > 0 && (
                                    <div className="acal-removed-block">
                                        <strong>🔴 Dropped by this upload</strong>
                                        <p className="acal-muted">These are in the live calendar but not the new PDF. Click one to keep it.</p>
                                        {removedEntries.map((e, ri) => (
                                            <button key={ri} className="acal-rm" onClick={() => restoreRemoved(ri)} title="Click to keep this event">
                                                <span className="acal-rm-title">{e.title}</span>
                                                <span className="acal-rm-date">{e.startDate ? fmt(e.startDate) : 'date not set'} · keep ＋</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* MOBILE: agenda list */}
                            <div className="acal-agenda">
                                {removedEntries.map((e, ri) => (
                                    <button key={'rm' + ri} className="acal-ag removed" onClick={() => restoreRemoved(ri)} title="Click to keep this event">
                                        <span className="acal-ag-date">{e.startDate ? fmt(e.startDate) : 'date not set'}</span>
                                        <span className="acal-ag-title">🔴 {e.title} <span className="acal-rm-keep">— tap to keep</span></span>
                                        <span className="acal-ag-cat">Dropped by this upload</span>
                                    </button>
                                ))}
                                {agenda.map(({ e, i }) => (
                                    <button key={i} className={`acal-ag ${e.tentative ? 'tentative' : ''} ${e._change === 'added' ? 'chg-add' : ''} ${e._change === 'moved' ? 'chg-moved' : ''}`} style={{ background: rowTint(e) }} onClick={() => setEditingIdx(i)}>
                                        <span className="acal-ag-date">
                                            {e.startDate ? fmt(e.startDate) + (e.endDate && e.endDate !== e.startDate ? ' – ' + fmt(e.endDate) : '') : '⚠️ date not set'}
                                            {e._change === 'moved' && e._movedFrom && <span className="acal-ag-moved"> (was {fmt(e._movedFrom.startDate)})</span>}
                                        </span>
                                        <span className="acal-ag-title">{e._change === 'added' && '🟢 '}{e._change === 'moved' && '🟠 '}{e.tentative && '🟡 '}{e.title}</span>
                                        <span className="acal-ag-cat">{e.category}{e.isHoliday ? ' · Holiday' : ''}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="acal-modal-foot">
                            <button className="btn btn-outline" onClick={() => addEntry(null)} disabled={publishing}><Plus size={15} /> Add event</button>
                            <div className="acal-foot-right">
                                <button className="btn btn-outline" onClick={reset} disabled={publishing}>Cancel</button>
                                <button className="btn btn-yellow" onClick={publish} disabled={publishing}>{publishing ? 'Publishing…' : 'Publish'}</button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* ── ENTRY EDITOR (portaled) ── */}
            {editingIdx !== null && entries[editingIdx] && createPortal(
                <div className="acal-editor-overlay" onClick={() => setEditingIdx(null)}>
                    <div className="acal-editor" onClick={(e) => e.stopPropagation()}>
                        <div className="acal-editor-head"><Pencil size={16} /> Edit entry<button className="acal-x" onClick={() => setEditingIdx(null)}><X size={16} /></button></div>
                        <label>Title<input value={entries[editingIdx].title} onChange={(e) => updateEntry(editingIdx, { title: e.target.value })} /></label>
                        <label>Category
                            <select value={entries[editingIdx].category} onChange={(e) => updateEntry(editingIdx, { category: e.target.value, isHoliday: e.target.value === 'Holiday' })}>
                                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </label>
                        <div className="acal-editor-dates">
                            <label>Start<input type="date" value={entries[editingIdx].startDate || ''} onChange={(e) => updateEntry(editingIdx, { startDate: e.target.value || null })} /></label>
                            <label>End<input type="date" value={entries[editingIdx].endDate || ''} onChange={(e) => updateEntry(editingIdx, { endDate: e.target.value || null })} /></label>
                        </div>
                        <label className="acal-check">
                            <input type="checkbox" checked={!!entries[editingIdx].tentative} onChange={(e) => updateEntry(editingIdx, { tentative: e.target.checked })} />
                            Mark as tentative / TBD
                        </label>
                        {entries[editingIdx].rawDateText && <p className="acal-raw">From PDF: “{entries[editingIdx].rawDateText}”</p>}
                        {entries[editingIdx].aiSuggestion && (
                            <div className="acal-ai">
                                <span>🤖 AI suggests: <strong>{entries[editingIdx].aiSuggestion.startDate}{entries[editingIdx].aiSuggestion.endDate !== entries[editingIdx].aiSuggestion.startDate ? ` → ${entries[editingIdx].aiSuggestion.endDate}` : ''}</strong></span>
                                <button className="btn btn-sm btn-outline" onClick={() => updateEntry(editingIdx, { startDate: entries[editingIdx].aiSuggestion.startDate, endDate: entries[editingIdx].aiSuggestion.endDate, tentative: true })}>Apply</button>
                            </div>
                        )}
                        <div className="acal-editor-foot">
                            <button className="acal-del" onClick={() => deleteEntry(editingIdx)}><Trash2 size={15} /> Delete event</button>
                            <button className="btn btn-yellow" onClick={() => setEditingIdx(null)}><CheckCircle2 size={16} /> Done</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}
