import remindersService from './reminders';
import noticeRemindersService from './noticeReminders';

const STORAGE_KEY = 'event-reminder-subscriptions-v1';
const SENT_KEY = 'event-reminder-sent-v1';
const REMINDERS_UPDATED_EVENT = 'event-reminders-updated';
// One reminder, 30 minutes out. Was [30, 5]: two buzzes for every event, and the 5-minute one lands
// too late to leave your room for it. The picker on the bell offers 5/15/30m/1h for anyone who wants
// more or different.
const DEFAULT_REMINDER_OFFSETS_MINUTES = [30];
const MAX_TIMEOUT_MS = 2147483647;
const CHECK_INTERVAL_MS = 20 * 1000;
const DUE_WINDOW_MS = 2 * 60 * 1000;

const timerMap = new Map();
let monitorIntervalId = null;
let monitorWired = false;
let syncRequestCounter = 0;

const parseJson = (value, fallback) => {
    try {
        const parsed = JSON.parse(value);
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
};

const emitRemindersUpdated = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(REMINDERS_UPDATED_EVENT));
};

const getSubscriptions = () => {
    if (typeof window === 'undefined') return {};
    return parseJson(localStorage.getItem(STORAGE_KEY), {});
};

const setSubscriptions = (subscriptions) => {
    if (typeof window === 'undefined') return;
    syncRequestCounter += 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subscriptions));
    emitRemindersUpdated();
};

const getSentMap = () => {
    if (typeof window === 'undefined') return {};
    return parseJson(localStorage.getItem(SENT_KEY), {});
};

const setSentMap = (sentMap) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(SENT_KEY, JSON.stringify(sentMap));
};

const reminderKey = (eventId, offsetMinutes) => `${eventId}-${offsetMinutes}`;

const isServerPersistableEventId = (eventId) => /^\d+$/.test(String(eventId));

/**
 * Which backend owns this subscription, if any.
 *
 * A purely numeric id is an EVENT and goes to /reminders. A `notice-<id>` id is a NOTICE and goes to
 * /notice-reminders with the prefix stripped — the prefix exists precisely so a notice id can never
 * be POSTed to the events API, where it would write a reminder against an unrelated event of the
 * same number. Anything else (academic/todo synthetic ids) stays local-only, as it always has.
 */
const NOTICE_ID = /^notice-(\d+)$/;
const backendFor = (id) => {
    const raw = String(id);
    if (isServerPersistableEventId(raw)) return { service: remindersService, remoteId: raw, kind: 'event' };
    const match = NOTICE_ID.exec(raw);
    if (match) return { service: noticeRemindersService, remoteId: match[1], kind: 'notice' };
    return null;
};

const normalizeOffsetsMinutes = (offsetsMinutes) => {
    const source = Array.isArray(offsetsMinutes) && offsetsMinutes.length > 0
        ? offsetsMinutes
        : DEFAULT_REMINDER_OFFSETS_MINUTES;

    const normalized = source
        .map((offset) => Number(offset))
        .filter((offset) => Number.isFinite(offset) && offset > 0)
        .map((offset) => Math.floor(offset));

    return Array.from(new Set(normalized)).sort((a, b) => b - a);
};

const normalizeEvent = (event, offsetsMinutes) => {
    if (!event || event.id == null || !event.tentative_start_time) return null;

    return {
        id: String(event.id),
        name: event.name || 'Upcoming Event',
        tentative_start_time: event.tentative_start_time,
        location_name: event.location_name || 'Campus',
        club_name: event.club_name || 'IITR Campus',
        offsetsMinutes: normalizeOffsetsMinutes(offsetsMinutes),
    };
};

const mergeRemoteSubscriptions = (remoteEntries) => {
    const current = getSubscriptions();
    // Server-owned locally = events AND notices. With the old numeric-only test, a notice reminder
    // deleted on another device kept its local timer running and would still fire here.
    const currentPersistableIds = Object.values(current)
        .map((entry) => entry.id)
        .filter((id) => backendFor(id));
    const merged = {};

    // Keep local-only events (academic/todo synthetic ids) untouched. `notice-<id>` entries are NO
    // LONGER local-only — they are server-owned now, so backendFor() decides, not the numeric test.
    // Using the old test here would let a stale local copy overwrite what the server just returned.
    Object.values(current).forEach((entry) => {
        if (!backendFor(entry.id)) {
            merged[entry.id] = {
                ...entry,
                offsetsMinutes: normalizeOffsetsMinutes(entry.offsetsMinutes),
            };
        }
    });

    remoteEntries.forEach((entry) => {
        const normalized = normalizeEvent(entry, entry.offsetsMinutes);
        if (normalized) {
            merged[normalized.id] = normalized;
        }
    });

    const remotePersistableIds = new Set(
        remoteEntries
            .map((entry) => String(entry?.id))
            .filter((id) => backendFor(id))
    );

    // Always reset timers for server-synced events so removed offsets do not fire stale alarms.
    remotePersistableIds.forEach((id) => {
        clearTimersForEvent(id);
    });

    currentPersistableIds
        .filter((id) => !remotePersistableIds.has(String(id)))
        .forEach((id) => {
            clearTimersForEvent(id);
            clearSentKeysForEvent(id);
        });

    setSubscriptions(merged);
};

const clearTimersForEvent = (eventId) => {
    Array.from(timerMap.keys()).forEach((key) => {
        if (!key.startsWith(`${eventId}-`)) return;
        const timer = timerMap.get(key);
        if (timer) {
            clearTimeout(timer);
            timerMap.delete(key);
        }
    });
};

const clearSentKeysForEvent = (eventId) => {
    const sentMap = getSentMap();
    Object.keys(sentMap).forEach((key) => {
        if (key.startsWith(`${eventId}-`)) {
            delete sentMap[key];
        }
    });
    setSentMap(sentMap);
};

const clearSentKeysForOffsets = (eventId, offsetsMinutes) => {
    const sentMap = getSentMap();
    offsetsMinutes.forEach((offsetMinutes) => {
        delete sentMap[reminderKey(eventId, offsetMinutes)];
    });
    setSentMap(sentMap);
};

const clearAllTimers = () => {
    Array.from(timerMap.values()).forEach((timer) => {
        if (timer) {
            clearTimeout(timer);
        }
    });
    timerMap.clear();
};

const markSent = (eventId, offsetMinutes) => {
    const sentMap = getSentMap();
    sentMap[reminderKey(eventId, offsetMinutes)] = Date.now();
    setSentMap(sentMap);
};

const hasSent = (eventId, offsetMinutes) => {
    const sentMap = getSentMap();
    return Boolean(sentMap[reminderKey(eventId, offsetMinutes)]);
};

const pruneOldData = () => {
    const now = Date.now();
    const subscriptions = getSubscriptions();
    let changed = false;

    Object.values(subscriptions).forEach((sub) => {
        const startTs = new Date(sub.tentative_start_time).getTime();
        if (!Number.isFinite(startTs) || startTs < now - 24 * 60 * 60 * 1000) {
            changed = true;
            clearTimersForEvent(sub.id);
            delete subscriptions[sub.id];
            clearSentKeysForEvent(sub.id);
        }
    });

    if (changed) {
        setSubscriptions(subscriptions);
    }
};

const notificationBody = (event, offsetMinutes) => {
    const start = new Date(event.tentative_start_time);
    const timeLabel = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    // "in 1 minutes" — the one-minute reminder is the one a student is most likely to actually read,
    // and it was the one with a grammatical error in it. Hours read better than 60/90 minutes too.
    const mins = Number(offsetMinutes);
    const when = mins >= 60 && mins % 60 === 0
        ? `${mins / 60} hour${mins / 60 === 1 ? '' : 's'}`
        : `${mins} minute${mins === 1 ? '' : 's'}`;
    const where = event.location_name ? ` (${event.location_name})` : '';
    return `${event.name} starts in ${when} at ${timeLabel}${where}.`;
};

const showReminderNotification = async (event, offsetMinutes) => {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;

    const title = `Event Reminder • ${offsetMinutes} min`;
    const body = notificationBody(event, offsetMinutes);
    const commonOptions = {
        body,
        // BASE_URL, not a bare '/'. The app is served under /app/ (vite base), and in production the SPA
        // sits behind the same prefix on CloudFront — so a root-absolute path 404s and every reminder
        // was delivered with no icon at all. Only visible by letting a notification actually fire.
        icon: `${import.meta.env.BASE_URL}pwa-icon-192.svg`,
        badge: `${import.meta.env.BASE_URL}pwa-icon-192.svg`,
        tag: `event-reminder-${event.id}-${offsetMinutes}`,
        data: {
            url: `/event/${event.id}`,
            eventId: event.id,
            offsetMinutes,
        },
    };

    try {
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) {
                await registration.showNotification(title, commonOptions);
                return;
            }
        }

        // Fallback when service worker registration is unavailable.
        // eslint-disable-next-line no-new
        new Notification(title, commonOptions);
    } catch (error) {
        console.error('Failed to show event reminder notification:', error);
    }
};

const scheduleEventReminder = (event, offsetMinutes) => {
    const key = reminderKey(event.id, offsetMinutes);
    clearTimeout(timerMap.get(key));
    timerMap.delete(key);

    const eventStartMs = new Date(event.tentative_start_time).getTime();
    if (!Number.isFinite(eventStartMs)) return;

    const triggerAtMs = eventStartMs - offsetMinutes * 60 * 1000;
    const delayMs = triggerAtMs - Date.now();

    if (delayMs <= 0 || hasSent(event.id, offsetMinutes)) return;

    // For very long delays, rely on monitor polling near trigger time.
    if (delayMs > MAX_TIMEOUT_MS) return;

    const timer = setTimeout(async () => {
        await showReminderNotification(event, offsetMinutes);
        markSent(event.id, offsetMinutes);
        timerMap.delete(key);
    }, delayMs);

    timerMap.set(key, timer);
};

const scheduleEvent = (event) => {
    const offsetsMinutes = normalizeOffsetsMinutes(event.offsetsMinutes);

    offsetsMinutes.forEach((offsetMinutes) => {
        scheduleEventReminder(event, offsetMinutes);
    });
};

const checkAndFireDueReminders = async () => {
    const subscriptions = getSubscriptions();
    const now = Date.now();

    for (const event of Object.values(subscriptions)) {
        const eventStartMs = new Date(event.tentative_start_time).getTime();
        if (!Number.isFinite(eventStartMs)) continue;

        for (const offsetMinutes of normalizeOffsetsMinutes(event.offsetsMinutes)) {
            const key = reminderKey(event.id, offsetMinutes);
            if (hasSent(event.id, offsetMinutes)) continue;

            const triggerAtMs = eventStartMs - offsetMinutes * 60 * 1000;
            // Fire if due now, or if app just resumed and reminder was missed shortly before.
            if (now >= triggerAtMs && now - triggerAtMs <= DUE_WINDOW_MS) {
                await showReminderNotification(event, offsetMinutes);
                markSent(event.id, offsetMinutes);
                const timer = timerMap.get(key);
                if (timer) {
                    clearTimeout(timer);
                    timerMap.delete(key);
                }
            }
        }
    }
};

const ensureReminderMonitor = () => {
    if (typeof window === 'undefined') return;

    if (!monitorIntervalId) {
        monitorIntervalId = setInterval(() => {
            checkAndFireDueReminders();
        }, CHECK_INTERVAL_MS);
    }

    if (!monitorWired) {
        const onForeground = () => {
            checkAndFireDueReminders();
        };

        window.addEventListener('focus', onForeground);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                onForeground();
            }
        });

        monitorWired = true;
    }
};

const isReminderSupported = () => {
    if (typeof window === 'undefined') return false;
    return 'Notification' in window;
};

const requestPermission = async () => {
    if (!isReminderSupported()) return 'unsupported';

    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';

    try {
        return await Notification.requestPermission();
    } catch {
        return 'denied';
    }
};

const eventReminderService = {
    isReminderSupported,

    getReminderIds: () => {
        const subscriptions = getSubscriptions();
        return Object.keys(subscriptions);
    },

    getReminderEntries: () => {
        const subscriptions = getSubscriptions();
        return Object.values(subscriptions)
            .map((event) => ({
                ...event,
                offsetsMinutes: normalizeOffsetsMinutes(event.offsetsMinutes),
            }))
            .sort((a, b) => new Date(a.tentative_start_time) - new Date(b.tentative_start_time));
    },

    isReminderEnabled: (eventId) => {
        const subscriptions = getSubscriptions();
        return Boolean(subscriptions[String(eventId)]);
    },

    scheduleStoredReminders: () => {
        pruneOldData();

        // Start with cached subscriptions for instant behavior.
        const cached = getSubscriptions();
        Object.values(cached).forEach((event) => scheduleEvent(event));
        ensureReminderMonitor();
        checkAndFireDueReminders();

        // Refresh from backend for cross-device persistence.
        const requestId = ++syncRequestCounter;
        // Both backends, together. Promise.all rather than two independent syncs because
        // mergeRemoteSubscriptions REPLACES the persisted half of the store — running it twice would
        // let the second call drop whatever the first had just merged in.
        Promise.all([
            remindersService.getAll(),
            noticeRemindersService.getAll().catch(() => []),   // notices are additive; never block events on them
        ])
            .then(([eventEntries, noticeEntries]) => {
                const remoteEntries = [...eventEntries, ...noticeEntries];
                if (requestId !== syncRequestCounter) return;
                mergeRemoteSubscriptions(remoteEntries);
                const subscriptions = getSubscriptions();
                Object.values(subscriptions).forEach((event) => scheduleEvent(event));
                checkAndFireDueReminders();
            })
            .catch((error) => {
                if (requestId !== syncRequestCounter) return;
                console.warn('Could not sync reminders from server, using local cache:', error?.message || error);
            });
    },

    clearLocalCache: () => {
        clearAllTimers();
        setSubscriptions({});
        setSentMap({});
    },

    updateReminderSnapshot: (event) => {
        const subscriptions = getSubscriptions();
        const normalized = normalizeEvent(event, subscriptions[String(event?.id)]?.offsetsMinutes);
        if (!normalized) return;

        const current = subscriptions[normalized.id];
        if (!current) return;

        const currentOffsets = normalizeOffsetsMinutes(current.offsetsMinutes);
        const nextOffsets = normalizeOffsetsMinutes(normalized.offsetsMinutes);
        const isSameSnapshot =
            String(current.name || '') === String(normalized.name || '')
            && String(current.tentative_start_time || '') === String(normalized.tentative_start_time || '')
            && String(current.location_name || '') === String(normalized.location_name || '')
            && String(current.club_name || '') === String(normalized.club_name || '')
            && currentOffsets.length === nextOffsets.length
            && currentOffsets.every((offset, index) => offset === nextOffsets[index]);

        if (isSameSnapshot) return;

        subscriptions[normalized.id] = {
            ...current,
            ...normalized,
            offsetsMinutes: nextOffsets,
        };
        setSubscriptions(subscriptions);
        scheduleEvent(subscriptions[normalized.id]);
    },

    toggleReminder: async (event) => {
        const normalized = normalizeEvent(event);
        if (!normalized) {
            return { enabled: false, error: 'invalid-event' };
        }

        const subscriptions = getSubscriptions();

        if (subscriptions[normalized.id]) {
            const target = backendFor(normalized.id);
            if (target) {
                try {
                    await target.service.disable(target.remoteId);
                } catch {
                    return { enabled: true, error: 'sync-failed' };
                }
            }

            clearTimersForEvent(normalized.id);
            delete subscriptions[normalized.id];
            setSubscriptions(subscriptions);
            clearSentKeysForEvent(normalized.id);
            return { enabled: false };
        }

        // Ask for permission, but do NOT make the subscription conditional on the answer.
        //
        // Tracking an event is an IN-APP action: it belongs on the reminder hub whether or not the
        // operating system will ever raise a banner. Gating it meant a student who dismissed the
        // browser prompt — or was on a browser that refuses it outright — tapped the bell, watched it
        // spring straight back to off, and found /notifications permanently empty with no route to
        // fixing it short of digging through Chrome's site settings.
        //
        // Delivery is still gated, one layer down: showReminderNotification() returns early unless
        // permission is 'granted', so no notification is ever raised without consent. The permission
        // is reported back so the caller can say device alerts are off without calling this a failure.
        const permission = await requestPermission();

        const eventStartMs = new Date(normalized.tentative_start_time).getTime();
        if (!Number.isFinite(eventStartMs) || eventStartMs <= Date.now()) {
            return { enabled: false, error: 'event-started' };
        }

        const target = backendFor(normalized.id);
        if (target) {
            try {
                const persisted = await target.service.setOffsets(target.remoteId, normalized.offsetsMinutes);
                if (persisted) {
                    // A NOTICE response carries only the id and its offsets — the title and time are
                    // already correct locally — so every other field falls back to what we hold.
                    normalized.name = persisted.name || normalized.name;
                    normalized.tentative_start_time = persisted.tentative_start_time || normalized.tentative_start_time;
                    normalized.location_name = persisted.location_name || normalized.location_name;
                    normalized.club_name = persisted.club_name || normalized.club_name;
                    normalized.offsetsMinutes = normalizeOffsetsMinutes(persisted.offsetsMinutes);
                }
            } catch {
                return { enabled: false, error: 'sync-failed' };
            }
        }

        subscriptions[normalized.id] = normalized;
        setSubscriptions(subscriptions);
        clearSentKeysForEvent(normalized.id);
        scheduleEvent(normalized);
        ensureReminderMonitor();
        checkAndFireDueReminders();

        return { enabled: true, permission };
    },

    setReminderOffsets: async (event, offsetsMinutes) => {
        const normalized = normalizeEvent(event, offsetsMinutes);
        if (!normalized) {
            return { enabled: false, error: 'invalid-event' };
        }

        const subscriptions = getSubscriptions();
        const previousOffsets = normalizeOffsetsMinutes(subscriptions[normalized.id]?.offsetsMinutes);
        const nextOffsets = normalized.offsetsMinutes;

        // Same reasoning as toggleReminder: ask, but never refuse the subscription over the answer.
        let permission = typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
        if (!subscriptions[normalized.id]) {
            permission = await requestPermission();
        }

        const eventStartMs = new Date(normalized.tentative_start_time).getTime();
        if (!Number.isFinite(eventStartMs) || eventStartMs <= Date.now()) {
            return { enabled: false, error: 'event-started' };
        }

        const target = backendFor(normalized.id);
        if (target) {
            try {
                const persisted = await target.service.setOffsets(target.remoteId, normalized.offsetsMinutes);
                if (persisted) {
                    // A NOTICE response carries only the id and its offsets — the title and time are
                    // already correct locally — so every other field falls back to what we hold.
                    normalized.name = persisted.name || normalized.name;
                    normalized.tentative_start_time = persisted.tentative_start_time || normalized.tentative_start_time;
                    normalized.location_name = persisted.location_name || normalized.location_name;
                    normalized.club_name = persisted.club_name || normalized.club_name;
                    normalized.offsetsMinutes = normalizeOffsetsMinutes(persisted.offsetsMinutes);
                }
            } catch {
                return { enabled: false, error: 'sync-failed' };
            }
        }

        subscriptions[normalized.id] = normalized;
        setSubscriptions(subscriptions);
        clearTimersForEvent(normalized.id);
        clearSentKeysForOffsets(
            normalized.id,
            previousOffsets.filter((offset) => !nextOffsets.includes(offset))
        );
        scheduleEvent(normalized);
        ensureReminderMonitor();
        checkAndFireDueReminders();

        return { enabled: true, permission };
    },
};

export default eventReminderService;
