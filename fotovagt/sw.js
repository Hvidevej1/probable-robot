// Service worker: viser push-beskeder (også når telefonen er låst) og åbner hændelsen ved klik.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* altid netværk: data skal være friske */ });

self.addEventListener('push', e => {
  let b = { title: 'Fotovagt', body: 'Der er nyt i Fotovagt.', tag: 'fotovagt', url: './' };
  try { b = { ...b, ...e.data.json() }; } catch { /* brug standardtekst */ }
  e.waitUntil(self.registration.showNotification(b.title, {
    body: b.body, icon: 'icon-192.png', badge: 'icon-192.png', tag: b.tag, renotify: true,
    vibrate: [200, 100, 200], data: { url: b.url },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const vinduer = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const v of vinduer) {
      if ('focus' in v) { v.postMessage({ åbn: url }); return v.focus(); }
    }
    return self.clients.openWindow(url);
  })());
});
