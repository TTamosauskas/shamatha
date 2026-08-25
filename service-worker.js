const CACHE = 'shamatha-shell-v9';
const SHELL = [
  './',
  './index.html',
  './app.html?v=20260825-0635',
  './assets/app.css?v=20260825-0635',
  './assets/app-cleanup.css?v=20260825-0635',
  './assets/practice-flow.css?v=20260825-0635',
  './assets/header-reminder.css?v=20260825-0635',
  './assets/practice-ux.js?v=20260825-0635',
  './assets/journey-replay.js?v=20260825-0635',
  './assets/app.js?v=20260825-0635',
  './assets/practice-audio-polish.js?v=20260825-0635',
  './assets/pwa.js?v=20260825-0635',
  './assets/header-reminder.js?v=20260825-0635'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).catch(() => null));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

// Navegações sempre tentam a rede primeiro. Isso evita que uma PWA instalada
// continue abrindo um app.html antigo depois de uma atualização.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;

  event.respondWith((async () => {
    try {
      return await fetch(request, { cache:'no-store' });
    } catch (_) {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/app.html') || url.pathname.endsWith('/shamatha/')) {
        return (await caches.match('./app.html?v=20260825-0635')) || Response.error();
      }
      return (await caches.match(request)) || (await caches.match('./index.html')) || Response.error();
    }
  })());
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