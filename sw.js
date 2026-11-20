// Service worker do Home Upkeep: deixa o app instalável e mostra as notificações push
// (enviadas pelo Apps Script via Firebase Cloud Messaging). Não guarda nada em cache.
const SW_VERSION = 2;

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {});

// Usa o mesmo ícone do app (que está embutido no manifest.json).
function appIcon() {
  return fetch('manifest.json').then(r => r.json()).then(m => (m.icons && m.icons[0] && m.icons[0].src) || undefined).catch(() => undefined);
}

self.addEventListener('push', e => {
  let msg = {};
  try { msg = e.data ? e.data.json() : {}; } catch (err) { msg = { data: { body: e.data && e.data.text() } }; }
  const d = msg.data || msg.notification || {};
  const title = d.title || 'Manutenção da Casa';
  e.waitUntil(appIcon().then(icon => self.registration.showNotification(title, {
    body: d.body || '',
    icon: icon,
    tag: 'home-upkeep',
    renotify: true,
    data: { url: d.url || self.registration.scope },
  })));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(url) && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
