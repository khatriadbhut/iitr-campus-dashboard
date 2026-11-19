// Tombstone. The app used to live at the root of this distribution with a service worker
// registered at scope "/". The app has moved to /app/ and the root is now the landing page,
// so that old worker would go on serving a cached app shell whose assets no longer resolve.
// Browsers re-fetch /sw.js on navigation; this replaces the old worker, clears its caches,
// unregisters itself, and reloads the tab onto whatever the root actually serves now.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(function (c) { c.navigate(c.url); });
  })());
});
