/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NetworkFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';

/**
 * The app's service worker.
 *
 * This file exists only because push notifications require it: a `push` handler cannot be added to
 * a worker that Workbox generates for us, so the plugin was switched from `generateSW` to
 * `injectManifest`. Everything below the push handlers is a hand-port of the config that used to
 * live in vite.config.js, and it must stay equivalent — this worker controls what the whole app
 * loads offline, and a mistake here breaks the app for anyone who already has it installed.
 *
 * Carried over deliberately, do not drop:
 *   · precaching of the built assets
 *   · navigation fallback to /app/index.html
 *   · the /api/ DENYLIST on that fallback  ← without it, login silently breaks (see below)
 *   · NetworkFirst for /api/*, excluding /api/oauth/*
 *   · autoUpdate behaviour (skipWaiting + clientsClaim)
 */

self.skipWaiting();
clientsClaim();

// __WB_MANIFEST is replaced at build time with the list of precached assets.
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

/**
 * SPA navigation fallback.
 *
 * The denylist is load-bearing. Without it the worker answers EVERY navigation with the cached
 * index.html — including /api/oauth/login — so pressing "log in" just re-rendered the SPA and the
 * Channel-i redirect never happened. It only reproduces in a browser that has the worker
 * registered, which is why it looked fine in curl.
 */
registerRoute(new NavigationRoute(
    createHandlerBoundToURL('/app/index.html'),
    { denylist: [/^\/api\//] },
));

/**
 * Same-origin API reads. Auth is excluded: a cached login redirect or token exchange would replay a
 * stale one-time state/code and fail the CSRF check.
 */
registerRoute(
    ({ url }) => url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/oauth/'),
    new NetworkFirst({
        cacheName: 'api-cache',
        networkTimeoutSeconds: 10,
        plugins: [
            new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 }),
            new CacheableResponsePlugin({ statuses: [0, 200] }),
        ],
    }),
);

// ── Push ─────────────────────────────────────────────────────────────────────

/**
 * A notification arrived.
 *
 * Wrapped in a try/catch that still shows SOMETHING: a push event whose handler throws, or which
 * calls no showNotification at all, is a spec violation that some browsers punish by revoking the
 * site's push permission. A generic banner is far better than losing the subscription.
 */
self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

    const title = data.title || 'Campus Dashboard';
    const options = {
        body: data.body || '',
        // `tag` means a re-send REPLACES the previous banner instead of stacking a second one —
        // the generator's dedup key doubles as the tag.
        tag: data.tag || undefined,
        renotify: false,
        icon: '/app/pwa-192.png',
        // NO `badge`. Android draws the badge as a MONOCHROME SILHOUETTE: every non-transparent
        // pixel becomes solid white, so pointing it at the full-colour square icon rendered a blank
        // white circle next to every notification. A real badge needs a purpose-made asset — a small
        // transparent PNG containing only a white glyph. Until that exists, omitting it lets Android
        // fall back to the browser's own mark, which is at least recognisable.
        data: { url: data.url || '/app/notifications', id: data.id || null },
    };
    event.waitUntil((async () => {
        await self.registration.showNotification(title, options);
        // Tell any open page a push landed, so the unread badge updates immediately instead of
        // waiting up to a minute for its next poll. Also the only way to observe, from a page, that
        // this handler ran at all — the banner itself is drawn by the OS and may be suppressed there.
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of clients) c.postMessage({ type: 'push-received', id: data.id || null, tag: options.tag || null });
    })());
});

/**
 * Tapping the notification.
 *
 * Focuses an existing tab if one is open rather than opening a duplicate — a student who already has
 * the app open should be taken to the item, not given a second copy of the app. Falls back to
 * opening a window when nothing is running.
 */
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const path = (event.notification.data && event.notification.data.url) || '/app/notifications';
    // ABSOLUTE. openWindow resolves a relative path against the worker's own URL, which is not the
    // same thing as the app's route and was one reason tapping did nothing on Android.
    const target = new URL(path, self.location.origin).href;

    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

        // Already looking at it — just bring it forward.
        for (const client of all) {
            if (client.url === target && 'focus' in client) return client.focus();
        }

        // Reuse a same-origin window if we can actually navigate it. client.navigate() only works on
        // a client this worker CONTROLS; on an uncontrolled one it rejects. The previous version
        // swallowed that rejection and called focus() anyway, which surfaced the tab without moving
        // it — the notification appeared to do nothing at all.
        for (const client of all) {
            if (new URL(client.url).origin !== self.location.origin) continue;
            try {
                const navigated = await client.navigate(target);
                return (navigated || client).focus();
            } catch { /* cannot navigate this one — fall through and open a fresh window */ }
        }

        return self.clients.openWindow(target);
    })());
});
