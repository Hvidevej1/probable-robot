// Service worker: viser push-beskeder (også når telefonen er låst) og åbner hændelsen ved klik.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
// Ingen fetch-handler: alt hentes fra netværket (en tom handler gør kun navigationen langsommere)

self.addEventListener('push', e => {
  let b = { title: 'Fotovagt', body: 'Der er nyt i Fotovagt.', tag: 'fotovagt', url: './' };
  try { b = { ...b, ...e.data.json() }; } catch { /* brug standardtekst */ }
  e.waitUntil(self.registration.showNotification(b.title, {
    body: b.body, icon: 'icon-192.png', badge: 'icon-192.png', tag: b.tag, renotify: true,
    // SOS bliver stående, til man trykker, og vibrerer længe
    requireInteraction: !!b.sos,
    vibrate: b.sos ? [600, 200, 600, 200, 600, 200, 600] : [200, 100, 200],
    data: { url: b.url },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const vinduer = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Brug et åbent vindue på samme side (kontor.html eller marken), ellers åbn et nyt
    const side = new URL(url).pathname;
    const v = vinduer.find(w => new URL(w.url).pathname === side) || (side.endsWith('/') ? vinduer.find(w => !w.url.includes('kontor')) : null);
    if (v && 'focus' in v) { v.postMessage({ åbn: url }); return v.focus(); }
    return self.clients.openWindow(url);
  })());
});
