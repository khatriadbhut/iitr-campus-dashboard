import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity, CalendarDays, ChevronDown, FileText, Filter, Loader, Pause, Play, Search,
    ShieldAlert, X,
} from 'lucide-react';
import analyticsService from '../../services/analytics';
import './AnalyticsPanel.css';

/* ── Time ────────────────────────────────────────────────────────────────────
 * Two representations, on purpose. The relative one ("4m ago") is what you scan; the absolute one
 * is what you quote in an incident. The row shows the first and carries the second as a tooltip, so
 * neither costs a column.
 */
const ago = (iso) => {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '';
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return `${Math.max(s, 0)}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
};

const CLOCK = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const DAY = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short',
});
const FULL = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium',
});

/* ── Vocabulary ──────────────────────────────────────────────────────────── */
const ACTION_LABEL = {
    event_published: 'approved an event',
    notice_published: 'approved a notice',
    notice_posted_manual: 'posted a notice by hand',
    proposal_dismissed: 'rejected a proposal',
    calendar_published: 'updated the calendar',
    grant_admin: 'made an admin',
    revoke_admin: 'removed an admin',
    update_admin: 'changed permissions',
    grant_club_admin: 'made a club admin',
    revoke_club_admin: 'removed a club admin',
    login_failed: 'failed login',
    rate_limited: 'hit a rate limit',
    forbidden: 'was refused access',
    attack_attempt: 'attempted an attack',
};
const SECURITY = new Set(['login_failed', 'rate_limited', 'forbidden', 'attack_attempt']);

/** What the detector recognised, said in words rather than a slug. */
const THREAT_LABEL = {
    sql_injection: 'SQL injection',
    xss_attempt: 'script injection',
    path_traversal: 'path traversal',
    command_injection: 'command injection',
    scanner_probe: 'vulnerability scan',
};

/** Every action worth filtering to on its own, grouped the way they are investigated. */
const ACTION_FILTERS = [
    { group: 'Events & notices', keys: ['event_published', 'notice_published', 'notice_posted_manual', 'proposal_dismissed', 'calendar_published'] },
    { group: 'Permissions', keys: ['grant_admin', 'revoke_admin', 'update_admin', 'grant_club_admin', 'revoke_club_admin'] },
    { group: 'Security', keys: ['attack_attempt', 'rate_limited', 'login_failed', 'forbidden'] },
];

// `urgent` is a severity rather than a category, so it cuts across the others: a password spray and
// somebody being handed super admin belong in the same view, because they are investigated together.
const GROUPS = [
    { key: 'urgent', label: 'Urgent', urgent: true },
    { key: 'all', label: 'Everything' },
    { key: 'content', label: 'Events & notices' },
    { key: 'admin', label: 'Permissions' },
    { key: 'security', label: 'Security' },
];

/** Ranges are computed at click time, not stored as absolutes, so "last hour" stays the last hour. */
const RANGES = [
    { key: '1h', label: '1h', full: 'Last hour', ms: 3600e3 },
    { key: '24h', label: '24h', full: 'Last 24 hours', ms: 24 * 3600e3 },
    { key: '7d', label: '7d', full: 'Last 7 days', ms: 7 * 24 * 3600e3 },
    { key: '30d', label: '30d', full: 'Last 30 days', ms: 30 * 24 * 3600e3 },
    { key: 'all', label: 'All', full: 'All time', ms: null },
];

const PAGE = 50;
const TAIL_MS = 5000;

/**
 * What the row says happened.
 *
 * For an attack, the KIND is the action — "attempted an attack" is a category, not information, and
 * burying "SQL injection" one column to the right makes the reader work for the only word that
 * matters. So the label carries the kind and the subject carries the evidence.
 */
const actionLabel = (row) => {
    if (row.action === 'attack_attempt') {
        const kind = row.detail?.kind;
        return kind ? (THREAT_LABEL[kind] || kind) : 'attack attempt';
    }
    return ACTION_LABEL[row.action] || row.action;
};

/** The human-readable half of a row: what the action was actually about. */
const subject = (row) => {
    const d = row.detail || {};
    const target = row.target_name
        ? `${row.target_name}${row.target_enrolment ? ` (${row.target_enrolment})` : ''}`
        : null;

    // Permission changes first: "changed permissions" alone tells you nothing worth knowing, whereas
    // the person and the right that moved is the entire content of the row.
    if (row.action?.includes('admin')) {
        if (d.is_super_admin === true) return `${target || 'someone'} → SUPER ADMIN`;
        if (d.permission_names?.length) return `${target || 'someone'} · ${d.permission_names.join(', ')}`;
        if (d.club_name) return `${target || 'someone'} · ${d.club_name}`;
        return target || '';
    }
    // The captured payload IS the finding for an attack row — it is what tells you whether this was
    // a bored scanner or someone aiming at you. The kind has already been said in the action column.
    if (d.kind) return d.sample ? `${d.sample}${d.where ? `  (in ${d.where})` : ''}` : (d.path || '');
    if (d.title) return d.title;
    if (target) return target;
    if (d.reason) return d.reason;
    if (d.limiter) return `${d.limiter} limiter${d.path ? ` · ${d.path}` : ''}`;
    if (d.path) return d.path;
    return '';
};

/**
 * One control for "when", instead of five buttons and two date fields sitting in the toolbar.
 *
 * The presets are what get used ninety-nine times in a hundred; the custom range needs to exist and
 * does not need to be on screen. Collapsing both into a menu that states the current selection means
 * the toolbar reads as one sentence rather than a control panel.
 *
 * Defined at module scope, NOT inside AnalyticsPanel — a component declared inside another is a new
 * type on every render, so React unmounts and remounts it, and the menu would close the moment
 * anything above it changed.
 */
const RangeMenu = ({ range, from, to, onPreset, onCustom, onClear }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return undefined;
        const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', away);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
    }, [open]);

    const custom = Boolean(from || to);
    const label = custom
        ? `${from || '…'} → ${to || '…'}`
        : (RANGES.find((r) => r.key === range)?.full || 'Last 24 hours');

    return (
        <div className="lg-range-wrap" ref={ref}>
            <button
                type="button"
                className={`lg-range-btn${custom ? ' lg-range-btn-on' : ''}`}
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
            >
                <CalendarDays size={13} />
                {label}
                <ChevronDown size={13} />
            </button>

            {open && (
                <div className="lg-range-menu">
                    {RANGES.map((r) => (
                        <button
                            key={r.key}
                            type="button"
                            className={`lg-range-item${!custom && range === r.key ? ' lg-range-item-on' : ''}`}
                            onClick={() => { onPreset(r.key); setOpen(false); }}
                        >{r.full}</button>
                    ))}
                    <div className="lg-range-sep" />
                    <span className="lg-range-l">Exact dates</span>
                    <div className="lg-range-dates">
                        <input type="date" value={from} max={to || undefined}
                            onChange={(e) => onCustom(e.target.value, to)} aria-label="From date" />
                        <span>→</span>
                        <input type="date" value={to} min={from || undefined}
                            onChange={(e) => onCustom(from, e.target.value)} aria-label="To date" />
                    </div>
                    {custom && (
                        <button type="button" className="lg-range-reset" onClick={() => { onClear(); setOpen(false); }}>
                            Back to presets
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

const LogRow = ({ row, onOpen, isNew }) => {
    const security = SECURITY.has(row.action);
    const urgent = row.severity === 'urgent';
    const when = new Date(row.created_at);
    return (
        <button
            type="button"
            className={`lg-row${security ? ' lg-row-sec' : ''}${urgent ? ' lg-row-urgent' : ''}${isNew ? ' lg-row-new' : ''}`}
            onClick={() => onOpen(row)}
            title={urgent ? 'Needs attention' : undefined}
        >
            <span className="lg-c-time" title={FULL.format(when)}>
                <span className="lg-clock">{CLOCK.format(when)}</span>
                <span className="lg-day">{DAY.format(when)}</span>
            </span>

            <span className="lg-c-who">
                {row.actor_user_id ? (
                    <>
                        <span className="lg-name">{row.full_name || `user ${row.actor_user_id}`}</span>
                        <span className="lg-meta">
                            {row.enrolment_number || '—'}
                            {row.branch ? ` · ${row.branch}` : ''}
                        </span>
                    </>
                ) : (
                    <span className="lg-anon">anonymous</span>
                )}
            </span>

            <span className={`lg-c-action${security ? ' lg-danger' : ''}`}>
                {actionLabel(row)}
            </span>

            <span className="lg-c-subject" title={subject(row)}>{subject(row)}</span>

            <span className="lg-c-ip">{row.ip ? <code>{row.ip}</code> : <span className="lg-dash">—</span>}</span>

            <span className="lg-c-ago">{ago(row.created_at)}</span>
        </button>
    );
};

/** Detail lives in a drawer rather than an expanding row: the list keeps its shape while you read. */
const Drawer = ({ row, onClose, onFilterIp }) => {
    if (!row) return null;
    const security = SECURITY.has(row.action);
    return (
        <>
            <div className="lg-scrim" onClick={onClose} role="presentation" />
            <aside className="lg-drawer">
                <div className="lg-drawer-head">
                    <h4 className={security ? 'lg-danger' : undefined}>
                        {actionLabel(row)}
                    </h4>
                    <button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button>
                </div>

                <dl className="lg-dl">
                    {row.severity === 'urgent' && (
                        <>
                            <dt>Priority</dt>
                            <dd><span className="lg-urgent-pill">urgent — worth looking at now</span></dd>
                        </>
                    )}
                    <dt>When</dt><dd>{FULL.format(new Date(row.created_at))} IST</dd>
                    {row.actor_user_id ? (
                        <>
                            <dt>Who</dt><dd>{row.full_name || `user ${row.actor_user_id}`}</dd>
                            <dt>Enrolment</dt><dd><code>{row.enrolment_number || '—'}</code></dd>
                            <dt>Branch</dt>
                            <dd>{row.branch_department_name || row.branch || '—'}</dd>
                        </>
                    ) : (<><dt>Who</dt><dd>Not signed in</dd></>)}
                    <dt>IP</dt>
                    <dd>
                        {row.ip ? (
                            <>
                                <code>{row.ip}</code>
                                <button type="button" className="lg-inline-btn" onClick={() => onFilterIp(row.ip)}>
                                    see everything from this IP
                                </button>
                            </>
                        ) : '—'}
                    </dd>
                    {row.detail?.kind && (
                        <>
                            <dt>Attack</dt>
                            <dd>{THREAT_LABEL[row.detail.kind] || row.detail.kind}</dd>
                            <dt>Sent in</dt>
                            <dd>{row.detail.where === 'body' ? 'the request body' : 'the URL'}
                                {row.detail.path ? <> · <code>{row.detail.path}</code></> : null}</dd>
                            {row.detail.sample && (<><dt>Payload</dt><dd><code className="lg-payload">{row.detail.sample}</code></dd></>)}
                        </>
                    )}
                    {row.target_name && (<><dt>Target</dt><dd>{row.target_name} ({row.target_enrolment || '—'})</dd></>)}
                </dl>

                <div className="lg-raw">
                    <span className="lg-raw-l">Detail</span>
                    <pre>{JSON.stringify(row.detail || {}, null, 2)}</pre>
                </div>
            </aside>
        </>
    );
};

const AnalyticsPanel = () => {
    const [overview, setOverview] = useState(null);
    const [rows, setRows] = useState([]);
    const [counts, setCounts] = useState(null);
    const [content, setContent] = useState(null);
    const [cursor, setCursor] = useState(null);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(true);
    const [paging, setPaging] = useState(false);
    const [error, setError] = useState('');
    const [open, setOpen] = useState(null);

    const [group, setGroup] = useState('all');
    const [range, setRange] = useState('24h');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');       // debounced copy of `search`
    const [ip, setIp] = useState('');
    const [actions, setActions] = useState([]);      // exact-action filter, from the funnel panel
    const [showFilters, setShowFilters] = useState(false);
    const [tailing, setTailing] = useState(true);
    const [freshIds, setFreshIds] = useState(() => new Set());

    const newestId = useRef(null);
    const listRef = useRef(null);

    // Typing must not fire a query per keystroke.
    useEffect(() => {
        const t = setTimeout(() => setQuery(search.trim()), 300);
        return () => clearTimeout(t);
    }, [search]);

    // A custom range wins over the presets; picking a preset clears it.
    const filters = useMemo(() => {
        const urgentOnly = group === 'urgent';
        const f = {
            group: urgentOnly ? 'all' : group,
            severity: urgentOnly ? 'urgent' : undefined,
            q: query || undefined,
            ip: ip || undefined,
            actions: actions.length ? actions.join(',') : undefined,
        };
        if (from || to) {
            if (from) f.from = new Date(`${from}T00:00:00`).toISOString();
            if (to) f.to = new Date(`${to}T23:59:59.999`).toISOString();
        } else {
            const r = RANGES.find((x) => x.key === range);
            if (r?.ms) f.from = new Date(Date.now() - r.ms).toISOString();
        }
        return f;
    }, [group, query, ip, actions, from, to, range]);

    // ── First page (and every refetch when a filter changes) ──────────────────
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        (async () => {
            try {
                const [page, c] = await Promise.all([
                    analyticsService.logs({ ...filters, limit: PAGE }),
                    analyticsService.counts(filters),
                ]);
                if (cancelled) return;
                setRows(page.rows);
                setCursor(page.nextCursor);
                setHasMore(page.hasMore);
                setCounts(c);
                newestId.current = page.rows[0]?.id ?? null;
                setFreshIds(new Set());
                setError('');
            } catch (e) {
                if (!cancelled) {
                    setError(e?.response?.status === 403
                        ? 'Analytics is restricted to super admins.'
                        : 'Could not load the log.');
                }
            } finally { if (!cancelled) setLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [filters]);

    // Overview tiles refresh on their own cadence — they are a heavier query and do not need 5s.
    const loadOverview = useCallback(async () => {
        try { setOverview(await analyticsService.overview()); } catch { /* tiles are not critical */ }
    }, []);

    // Where content came from, and how long it sat between the email landing and going live. The log
    // above answers who approved it; this answers when it arrived, which no audit row can know.
    useEffect(() => {
        analyticsService.content().then(setContent).catch(() => {});
    }, []);
    useEffect(() => {
        loadOverview();
        const t = setInterval(loadOverview, 20000);
        return () => clearInterval(t);
    }, [loadOverview]);

    // ── Live tail ─────────────────────────────────────────────────────────────
    // Only asks for rows newer than the newest one held, so the cost does not grow with the page.
    // Pauses while a row is open — having the list move under you mid-read is the reason log viewers
    // offer a pause button at all.
    useEffect(() => {
        if (!tailing || open) return undefined;
        const t = setInterval(async () => {
            if (!newestId.current) { return; }
            try {
                const { rows: fresh } = await analyticsService.logs({
                    ...filters, since: newestId.current, limit: PAGE,
                });
                if (!fresh?.length) return;
                newestId.current = fresh[0].id;
                setFreshIds(new Set(fresh.map((r) => r.id)));
                setRows((prev) => [...fresh, ...prev]);
            } catch { /* a failed tail is a gap, not an error worth shouting about */ }
        }, TAIL_MS);
        return () => clearInterval(t);
    }, [tailing, open, filters]);

    // The highlight on newly-arrived rows fades; it marks what changed without becoming permanent.
    useEffect(() => {
        if (!freshIds.size) return undefined;
        const t = setTimeout(() => setFreshIds(new Set()), 2200);
        return () => clearTimeout(t);
    }, [freshIds]);

    const loadMore = async () => {
        if (!cursor || paging) return;
        setPaging(true);
        try {
            const page = await analyticsService.logs({ ...filters, before: cursor, limit: PAGE });
            setRows((prev) => [...prev, ...page.rows]);
            setCursor(page.nextCursor);
            setHasMore(page.hasMore);
        } catch { /* keep what is already on screen */ } finally { setPaging(false); }
    };

    // Reaching the bottom pages automatically; the button below stays as the explicit affordance.
    const onScroll = (e) => {
        const el = e.currentTarget;
        if (hasMore && !paging && el.scrollHeight - el.scrollTop - el.clientHeight < 240) loadMore();
    };

    const pickRange = (key) => { setRange(key); setFrom(''); setTo(''); };
    const filterByIp = (addr) => { setIp(addr); setOpen(null); setGroup('all'); };
    const clearAll = () => {
        setGroup('all'); setRange('24h'); setFrom(''); setTo('');
        setSearch(''); setQuery(''); setIp(''); setActions([]);
    };
    const toggleAction = (key) => setActions((prev) =>
        (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

    const filtered = Boolean(query || ip || actions.length || from || to || group !== 'all' || range !== '24h');

    return (
        <div className="an-wrap">
            {/* ── Right now ────────────────────────────────────────────────── */}
            {/* One line, not five cards. These are context for reading the log, and five boxes
                competing for attention made the one number that should change behaviour — urgent —
                just another box. It gets the emphasis; the rest state themselves and stop. */}
            <div className="an-summary">
                <span><b>{overview?.live?.now_5m ?? '—'}</b> online</span>
                <span className="an-sep">·</span>
                <span><b>{overview?.live?.last_hour ?? '—'}</b> this hour</span>
                <span className="an-sep">·</span>
                <span><b>{overview?.users?.total ?? '—'}</b> users</span>
                <span className="an-sep">·</span>
                <span><b>{overview?.content?.pending_review ?? '—'}</b> awaiting review</span>

                <button
                    type="button"
                    className={`an-urgent${counts?.groups?.urgent ? ' an-urgent-on' : ''}`}
                    onClick={() => setGroup('urgent')}
                    title="Show only what needs attention"
                >
                    <ShieldAlert size={13} />
                    <b>{counts?.groups?.urgent ?? 0}</b> need attention
                </button>
            </div>

            {/* ── Addresses worth a look ───────────────────────────────────── */}
            {overview?.topIps?.length > 0 && (
                <div className="an-ips">
                    <span className="an-ips-l">Repeat offenders, 24h</span>
                    {overview.topIps.map((r) => (
                        <button
                            key={r.ip}
                            type="button"
                            className={`an-ip${ip === r.ip ? ' an-ip-on' : ''}`}
                            onClick={() => filterByIp(r.ip)}
                            title={`Show every log line from ${r.ip}`}
                        >
                            <code>{r.ip}</code><b>×{r.n}</b>
                        </button>
                    ))}
                </div>
            )}

            {/* ── Controls ─────────────────────────────────────────────────── */}
            <div className="lg-bar">
                <div className="lg-groups">
                    {GROUPS.map((g) => (
                        <button
                            key={g.key}
                            type="button"
                            className={`lg-tab${group === g.key ? ' lg-tab-on' : ''}${g.key === 'security' ? ' lg-tab-sec' : ''}${g.urgent ? ' lg-tab-urgent' : ''}`}
                            onClick={() => setGroup(g.key)}
                        >
                            {g.label}
                            {counts?.groups?.[g.key] !== undefined && (
                                <span className="lg-count">{counts.groups[g.key]}</span>
                            )}
                        </button>
                    ))}
                </div>

                <div className="lg-tools">
                    <label className="lg-search">
                        <Search size={13} />
                        <input
                            type="search"
                            value={search}
                            placeholder="Search name, roll number, IP, title…"
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </label>

                    <RangeMenu
                        range={range}
                        from={from}
                        to={to}
                        onPreset={pickRange}
                        onCustom={(f, t) => { setFrom(f); setTo(t); }}
                        onClear={() => { setFrom(''); setTo(''); }}
                    />

                    <button
                        type="button"
                        className={`lg-funnel${showFilters || actions.length ? ' lg-funnel-on' : ''}`}
                        onClick={() => setShowFilters((v) => !v)}
                        title="More filters"
                        aria-expanded={showFilters}
                    >
                        <Filter size={13} />
                        {actions.length > 0 && <span className="lg-count">{actions.length}</span>}
                    </button>

                    <button
                        type="button"
                        className={`lg-live${tailing ? ' lg-live-on' : ''}`}
                        onClick={() => setTailing((v) => !v)}
                        title={tailing ? 'Pause the live stream' : 'Resume the live stream'}
                    >
                        {tailing ? <Pause size={13} /> : <Play size={13} />}
                        {tailing ? 'Live' : 'Paused'}
                    </button>
                </div>
            </div>

            {showFilters && (
                <div className="lg-filters">
                    {ACTION_FILTERS.map((section) => (
                        <div key={section.group} className="lg-fgroup">
                            <span className="lg-fgroup-l">{section.group}</span>
                            <div className="lg-fopts">
                                {section.keys.map((k) => (
                                    <button
                                        key={k}
                                        type="button"
                                        className={`lg-fopt${actions.includes(k) ? ' lg-fopt-on' : ''}`}
                                        onClick={() => toggleAction(k)}
                                    >
                                        {ACTION_LABEL[k] || k}
                                        {counts?.byAction?.[k] !== undefined && (
                                            <span className="lg-fopt-n">{counts.byAction[k]}</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                    <div className="lg-fgroup">
                        <span className="lg-fgroup-l">Address</span>
                        <input
                            className="lg-fip"
                            type="text"
                            value={ip}
                            placeholder="Exact IP, e.g. 45.13.22.9"
                            onChange={(e) => setIp(e.target.value.trim())}
                        />
                    </div>
                </div>
            )}

            {(ip || filtered) && (
                <div className="lg-active">
                    {ip && (
                        <span className="lg-chip">
                            IP <code>{ip}</code>
                            <button type="button" onClick={() => setIp('')} aria-label="Clear IP filter"><X size={11} /></button>
                        </span>
                    )}
                    {actions.map((a) => (
                        <span key={a} className="lg-chip">
                            {ACTION_LABEL[a] || a}
                            <button type="button" onClick={() => toggleAction(a)} aria-label="Remove filter"><X size={11} /></button>
                        </span>
                    ))}
                    {(from || to) && (
                        <span className="lg-chip">{from || '…'} → {to || '…'}
                            <button type="button" onClick={() => { setFrom(''); setTo(''); }} aria-label="Clear dates"><X size={11} /></button>
                        </span>
                    )}
                    <button type="button" className="lg-clear" onClick={clearAll}>Reset filters</button>
                </div>
            )}

            {/* ── The stream ───────────────────────────────────────────────── */}
            <div className="lg-head">
                <span className="lg-c-time">Time (IST)</span>
                <span className="lg-c-who">Who</span>
                <span className="lg-c-action">Did what</span>
                <span className="lg-c-subject">To what</span>
                <span className="lg-c-ip">IP</span>
                <span className="lg-c-ago" />
            </div>

            <div className="lg-list" ref={listRef} onScroll={onScroll}>
                {error && <div className="an-state an-error">{error}</div>}

                {!error && loading && (
                    <div className="an-state"><Loader size={15} className="an-spin" /> Loading…</div>
                )}

                {!error && !loading && rows.length === 0 && (
                    <div className="an-state an-empty-box">
                        <Activity size={18} />
                        <p><b>Nothing in this range.</b></p>
                        <p>
                            {filtered
                                ? 'Try a wider time range, or reset the filters.'
                                : 'Authorship is only recorded from the moment this feature shipped — anything published before that has no author stored and cannot be recovered.'}
                        </p>
                    </div>
                )}

                {!error && rows.map((r) => (
                    <LogRow key={r.id} row={r} onOpen={setOpen} isNew={freshIds.has(r.id)} />
                ))}

                {!error && hasMore && (
                    <button type="button" className="lg-more" onClick={loadMore} disabled={paging}>
                        {paging ? <><Loader size={13} className="an-spin" /> Loading…</>
                            : <><ChevronDown size={13} /> Load older</>}
                    </button>
                )}
                {!error && !hasMore && rows.length > 0 && (
                    <div className="lg-end">That is everything in this range.</div>
                )}
            </div>

            {/* ── Where content came from ──────────────────────────────────── */}
            {content && (
                <section className="an-section">
                    <h4><FileText size={13} /> Recent content</h4>
                    <p className="an-section-note">
                        The latest events and notices, and when the email they came from arrived.
                        Entries typed in by an admin have no source email.
                    </p>
                    <ul className="an-content">
                        {[...(content.recentEvents || []).slice(0, 6).map((e) => ({
                            k: `e${e.id}`, kind: 'event', title: e.name,
                            club: e.club_name, source: e.source, mail: e.email_arrived_at,
                        })), ...(content.recentNotices || []).slice(0, 6).map((n) => ({
                            k: `n${n.id}`, kind: 'notice', title: n.title,
                            club: n.club_name, source: n.source, mail: n.email_arrived_at,
                        }))].map((r) => (
                            <li key={r.k}>
                                <span className={`an-badge${r.kind === 'notice' ? ' an-badge-notice' : ''}`}>{r.kind}</span>
                                <span className="an-c-title">{r.title}</span>
                                <span className="an-c-meta">{r.club || 'Institute'} · {r.source || 'email'}</span>
                                <span className="an-c-when">
                                    {r.mail ? `email arrived ${ago(Number(r.mail))}` : 'added by hand'}
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <Drawer row={open} onClose={() => setOpen(null)} onFilterIp={filterByIp} />
        </div>
    );
};

export default AnalyticsPanel;
