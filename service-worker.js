const CACHE = 'shamatha-shell-v1';
const SHELL = ['./', './index.html', './app.html', './assets/app.css', './assets/app-cleanup.css'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json?.() || {}; }
  catch (_) { data = { body: event.data?.text?.() || '' }; }
  const title = data.title || 'Centro Pineal';
  const options = {
    body: data.body || 'Há uma atualização no seu caminho.',
    icon: './app-icon.svg',
    badge: './app-icon.svg',
    tag: data.tag || 'shamatha-notification',
    renotify: true,
    data: { url: data.url || './app.html' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './app.html', self.location.origin + self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    for (const client of windows) {
      if ('focus' in client) {
        if ('navigate' in client) await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
