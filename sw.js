// Service worker: viser push-beskeder og åbner appen, når man trykker på dem.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let msg = { title: 'Vores medicin', body: 'Der er nyt på medicinlisten.' };
  try { msg = { ...msg, ...e.data.json() }; } catch { /* brug standardtekst */ }
  e.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body, icon: 'icon-192.png', badge: 'icon-192.png', tag: msg.tag || 'medicin', renotify: true,
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) return all[0].focus();
    return self.clients.openWindow('./');
  })());
});
