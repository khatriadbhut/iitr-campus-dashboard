import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { BellRing, CalendarDays, CheckCheck, ClipboardList, FileText, Inbox, Loader } from 'lucide-react';
import notificationsService from '../../services/notifications';
import { notify } from '../../services/notify';
import './NotificationInbox.css';

/** Icon per notification type. Keeps a review batch visually distinct from a personal reminder. */
const ICONS = {
    todo: ClipboardList,
    reminder: BellRing,
    event: CalendarDays,
    notice: FileText,
    review: Inbox,
};

/**
 * Relative time, coarse on purpose. "3 days ago" is what a reader wants from a list like this;
 * an exact timestamp is noise they have to parse.
 */
const ago = (iso) => {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return '';
    const mins = Math.floor((Date.now() - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? 'yesterday' : `${days}d ago`;
};

/**
 * The delivered-notifications list. Distinct from the Reminders tab beside it, which manages FUTURE
 * subscriptions — this one is the record of what actually fired.
 *
 * Tapping a row marks it read and deep-links to its target (`url`, written by the generator), which
 * is the whole point: a notification you cannot act on from the list is just a log entry.
 */
const NotificationInbox = ({ onUnreadChange }) => {
    const navigate = useNavigate();
    const [items, setItems] = useState([]);
    const [unread, setUnread] = useState(0);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const { notifications, unread: u } = await notificationsService.list();
            setItems(notifications);
            setUnread(u);
            onUnreadChange?.(u);
        } catch {
            notify('Could not load notifications');
        } finally {
            setLoading(false);
        }
    }, [onUnreadChange]);

    useEffect(() => { load(); }, [load]);

    const open = async (item) => {
        // Optimistic: mark read locally first so the row settles immediately. A failed write only
        // costs an unread badge that reappears on reload — not worth blocking navigation for.
        if (!item.read_at) {
            setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)));
            setUnread((u) => {
                const next = Math.max(0, u - 1);
                onUnreadChange?.(next);
                return next;
            });
            notificationsService.markRead([item.id]).catch(() => { /* badge self-corrects on reload */ });
        }
        if (item.url) navigate(item.url.replace(/^\/app/, ''));
    };

    const markAll = async () => {
        const previous = items;
        const now = new Date().toISOString();
        setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || now })));
        setUnread(0);
        onUnreadChange?.(0);
        try {
            await notificationsService.markRead();
        } catch {
            setItems(previous);
            notify('Could not mark everything read');
            load();
        }
    };

    if (loading) {
        return <div className="notif-inbox-state"><Loader size={16} className="spin" /> Loading…</div>;
    }

    if (!items.length) {
        return (
            <div className="notif-inbox-empty card">
                <Inbox size={28} aria-hidden="true" />
                <h3>Nothing yet</h3>
                <p>
                    Reminders, new events from your clubs and your due todos will appear here.
                    Choose what you get in <strong>Profile → Notifications</strong>.
                </p>
            </div>
        );
    }

    return (
        <div className="notif-inbox">
            {unread > 0 && (
                <div className="notif-inbox-bar">
                    <span>{unread} unread</span>
                    <button type="button" onClick={markAll} className="notif-inbox-markall">
                        <CheckCheck size={14} aria-hidden="true" /> Mark all read
                    </button>
                </div>
            )}

            <ul className="notif-inbox-list">
                {items.map((item) => {
                    const Icon = ICONS[item.type] || Inbox;
                    return (
                        <li key={item.id}>
                            <button
                                type="button"
                                className={`notif-inbox-item${item.read_at ? '' : ' is-unread'}`}
                                onClick={() => open(item)}
                            >
                                <span className="notif-inbox-icon"><Icon size={16} aria-hidden="true" /></span>
                                <span className="notif-inbox-copy">
                                    <span className="notif-inbox-title">
                                        {item.title}
                                        {item.item_count > 1 ? <em className="notif-inbox-count">×{item.item_count}</em> : null}
                                    </span>
                                    {item.body ? <span className="notif-inbox-body">{item.body}</span> : null}
                                </span>
                                <span className="notif-inbox-time">{ago(item.created_at)}</span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
};

export default NotificationInbox;
