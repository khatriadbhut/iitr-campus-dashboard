import api from './api';

/**
 * Registering THIS device for push. The account-level "what am I told about" lives in
 * services/notifications.js; this is only "does this screen buzz".
 */

/** VAPID keys travel as base64url and the browser wants raw bytes. */
const urlBase64ToUint8Array = (base64String) => {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

/** iPadOS reports itself as a Mac, so touch points are the only reliable tell. */
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Installed to the home screen / running as an app rather than in a browser tab. */
const isInstalled = () => window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;

/**
 * What this device can actually do, as one of:
 *
 *   'ready'          push is possible here
 *   'ios-needs-install'  iPhone/iPad in Safari — push works ONLY from the home screen
 *   'unsupported'    no service worker or no Push API (old iOS, some in-app browsers)
 *   'denied'         the user has blocked notifications for this site
 *
 * The iOS case is called out separately because it is the one where everything LOOKS fine and
 * nothing arrives: Safari tabs on iOS cannot receive push at all, silently, and a student would
 * otherwise conclude the app is broken.
 */
const capability = () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    if (!('PushManager' in window) || typeof Notification === 'undefined') {
        return isIOS() && !isInstalled() ? 'ios-needs-install' : 'unsupported';
    }
    if (isIOS() && !isInstalled()) return 'ios-needs-install';
    if (Notification.permission === 'denied') return 'denied';
    return 'ready';
};

const pushDeviceService = {
    capability,
    isIOS,
    isInstalled,

    /** Is this exact browser already registered? */
    isSubscribed: async () => {
        if (!('serviceWorker' in navigator)) return false;
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return false;
        return !!(await reg.pushManager.getSubscription());
    },

    /**
     * Ask for permission, subscribe, and register with the server.
     * Returns { ok } or { ok:false, reason } — never throws at the caller.
     */
    subscribe: async () => {
        const cap = capability();
        if (cap !== 'ready') return { ok: false, reason: cap };

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return { ok: false, reason: 'denied' };

        const { data } = await api.get('/notifications/push-key');
        if (!data?.configured || !data?.publicKey) return { ok: false, reason: 'server-not-configured' };

        const reg = await navigator.serviceWorker.ready;
        // Re-use an existing subscription rather than creating a second one: the browser only allows
        // one per registration, and subscribing again with a different key throws.
        const existing = await reg.pushManager.getSubscription();
        const sub = existing || await reg.pushManager.subscribe({
            userVisibleOnly: true,          // required by Chrome; we always show a banner anyway
            applicationServerKey: urlBase64ToUint8Array(data.publicKey),
        });

        const json = sub.toJSON();
        await api.post('/notifications/subscribe', { endpoint: json.endpoint, keys: json.keys });
        return { ok: true };
    },

    /** Unregister this device, server-side and in the browser. */
    unsubscribe: async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg && await reg.pushManager.getSubscription();
        if (sub) {
            // Server first: if the browser unsubscribes and the POST then fails, the row is orphaned
            // and we would keep sending to a dead endpoint until it 410s.
            await api.post('/notifications/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
            await sub.unsubscribe();
        }
        return { ok: true };
    },
};

export default pushDeviceService;
