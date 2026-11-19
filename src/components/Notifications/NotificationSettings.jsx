import React, { useCallback, useEffect, useState } from 'react';
import { Bell, Loader, Smartphone } from 'lucide-react';
import notificationsService from '../../services/notifications';
import pushDeviceService from '../../services/pushDevice';
import { notify } from '../../services/notify';
import './NotificationSettings.css';

/**
 * Notification preferences, rendered inside Profile beneath Feed Preferences.
 *
 * Three channels, deliberately independent switches rather than a pick-one:
 *   MY THINGS   todos at their due time, and anything the user belled
 *   CAMPUS FEED newly published events/notices, EXCEPT clubs the user muted
 *   REVIEW      new items in the email review queue — admins only, and NOT affected by the feed
 *               settings above, because reviewing your club is a job, not a reading preference
 *
 * There is no "enable on this device" control yet. Nothing is delivered to a device in Phase 1 — the
 * generator only fills the in-app centre — and a switch that claims to turn on notifications while
 * silently doing nothing is worse than no switch at all. It arrives with the service worker.
 */
/**
 * Defined at module scope, NOT inside NotificationSettings.
 *
 * A component declared inside another component's body is a NEW type on every render, so React
 * unmounts and remounts the whole subtree each time state changes — the inputs are destroyed and
 * recreated mid-interaction. It looks fine in a screenshot and misbehaves in use: focus is lost, and
 * a click landing during a re-render hits a node that is already detached.
 */
const Toggle = ({ id, label, hint, checked, disabled, onChange }) => (
    <label className="notif-row" htmlFor={id}>
        <span className="notif-row-copy">
            <span className="notif-row-label">{label}</span>
            {hint ? <span className="notif-row-hint">{hint}</span> : null}
        </span>
        <input
            id={id}
            type="checkbox"
            className="notif-switch"
            checked={!!checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
        />
    </label>
);

const NotificationSettings = () => {
    const [prefs, setPrefs] = useState(null);
    const [canReview, setCanReview] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Per-DEVICE push state, separate from the per-account preferences above.
    const [cap, setCap] = useState('unsupported');
    const [subscribed, setSubscribed] = useState(false);
    const [deviceBusy, setDeviceBusy] = useState(false);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { prefs: p, canReview: cr } = await notificationsService.getPrefs();
                if (cancelled) return;
                setPrefs(p);
                setCanReview(cr);
            } catch {
                if (!cancelled) notify('Could not load notification settings');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        let cancelled = false;
        setCap(pushDeviceService.capability());
        pushDeviceService.isSubscribed()
            .then((v) => { if (!cancelled) setSubscribed(v); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, []);

    const toggleDevice = async () => {
        setDeviceBusy(true);
        try {
            if (subscribed) {
                await pushDeviceService.unsubscribe();
                setSubscribed(false);
                notify('Notifications turned off on this device', 'info');
            } else {
                const r = await pushDeviceService.subscribe();
                if (r.ok) { setSubscribed(true); notify('Notifications are on for this device', 'info'); }
                else if (r.reason === 'denied') notify('Your browser has blocked notifications for this site');
                else if (r.reason === 'server-not-configured') notify('Push is not set up on the server yet');
                else notify('Could not enable notifications on this device');
            }
        } catch {
            notify('Could not change notifications for this device');
        } finally { setDeviceBusy(false); setCap(pushDeviceService.capability()); }
    };

    /**
     * Optimistic, and it reverts on failure. These are toggles: waiting on a round-trip before the
     * switch moves feels broken, but leaving it moved after a failed save is a lie about what the
     * server believes — the next page load would silently contradict it.
     */
    const update = useCallback(async (patch) => {
        const previous = prefs;
        setPrefs((p) => ({ ...p, ...patch }));
        setSaving(true);
        try {
            const saved = await notificationsService.savePrefs(patch);
            if (saved) setPrefs(saved);
        } catch {
            setPrefs(previous);
            notify('Could not save that setting');
        } finally {
            setSaving(false);
        }
    }, [prefs]);

    if (loading) {
        return (
            <div className="notif-settings card">
                <div className="notif-settings-loading"><Loader size={16} className="spin" /> Loading notification settings…</div>
            </div>
        );
    }
    if (!prefs) return null;

    return (
        <div className="notif-settings card">
            <div className="notif-settings-header">
                <Bell size={18} aria-hidden="true" />
                <h2>Notifications</h2>
            </div>

            <section className="notif-group notif-device">
                <h3>This device</h3>
                {cap === 'ios-needs-install' ? (
                    /* The single most confusing case: on iPhone/iPad, Safari TABS cannot receive
                       push at all — silently. Without this the student turns everything on and
                       simply never hears anything. */
                    <div className="notif-device-hint">
                        <Smartphone size={16} aria-hidden="true" />
                        <div>
                            <strong>Add to Home Screen first</strong>
                            <p>
                                iPhones and iPads can only send notifications from an installed app.
                                Tap Share, then <em>Add to Home Screen</em>, and open it from there.
                            </p>
                        </div>
                    </div>
                ) : cap === 'unsupported' ? (
                    <div className="notif-device-hint">
                        <Smartphone size={16} aria-hidden="true" />
                        <div><strong>Not available in this browser</strong>
                            <p>Try Chrome, Edge or Safari 16.4+ installed to your home screen.</p></div>
                    </div>
                ) : cap === 'denied' ? (
                    <div className="notif-device-hint">
                        <Smartphone size={16} aria-hidden="true" />
                        <div><strong>Blocked in your browser</strong>
                            <p>Allow notifications for this site in your browser settings, then reload.</p></div>
                    </div>
                ) : (
                    <Toggle
                        id="notif-device"
                        label="Alerts on this device"
                        hint="Applies to this phone or computer only"
                        checked={subscribed}
                        disabled={deviceBusy}
                        onChange={toggleDevice}
                    />
                )}
            </section>

            <section className="notif-group">
                <h3>My things</h3>
                <Toggle
                    id="notif-todos" label="Todo reminders" hint="At the time you set"
                    checked={prefs.todos} disabled={saving} onChange={(v) => update({ todos: v })}
                />
                <Toggle
                    id="notif-saved" label="Saved events & notices" hint="The ones you've belled"
                    checked={prefs.saved_items} disabled={saving} onChange={(v) => update({ saved_items: v })}
                />
            </section>

            <section className="notif-group">
                <h3>Campus feed</h3>
                <Toggle
                    id="notif-feed" label="New events & notices"
                    hint="Clubs you've muted are never notified"
                    checked={prefs.campus_feed} disabled={saving} onChange={(v) => update({ campus_feed: v })}
                />
                <label className="notif-row notif-row-select" htmlFor="notif-notices">
                    <span className="notif-row-copy">
                        <span className="notif-row-label">Notices</span>
                        <span className="notif-row-hint">Which notices are worth interrupting you for</span>
                    </span>
                    <select
                        id="notif-notices"
                        value={prefs.campus_notices}
                        disabled={saving || !prefs.campus_feed}
                        onChange={(e) => update({ campus_notices: e.target.value })}
                    >
                        <option value="off">None</option>
                        <option value="important">Important only</option>
                        <option value="all">All notices</option>
                    </select>
                </label>
            </section>

            {canReview ? (
                <section className="notif-group">
                    <h3>Review queue</h3>
                    <Toggle
                        id="notif-review" label="New items to review"
                        hint="Grouped — at most one every 10 minutes. Separate from your feed settings above."
                        checked={prefs.review_queue} disabled={saving} onChange={(v) => update({ review_queue: v })}
                    />
                </section>
            ) : null}

            <p className="notif-settings-foot">
                Alerts always appear in your <strong>Notifications</strong> tab. Turn on
                <strong> this device</strong> above to also be notified when the app is closed.
            </p>
        </div>
    );
};

export default NotificationSettings;
