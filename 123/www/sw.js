const CACHE_NAME = 'buildpay-shell-20260602-0101';
const SHELL = [
  '/assets/css/app.css?v=20260602-0101',
  '/assets/js/app.js?v=20260602-0101',
  '/assets/icons/buildpay-192.png',
  '/assets/icons/buildpay-512.png',
  '/assets/icons/buildpay.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('buildpay-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
    return;
  }
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/update.html')) {
    event.respondWith(fetch(request, { cache: 'reload' }).catch(() => caches.match('/index.html')));
    return;
  }
  event.respondWith(fetch(request, { cache: 'reload' }).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, copy)).catch(() => {});
    return response;
  }).catch(() => caches.match(request).then(cached => cached || caches.match('/'))));
});

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'BuildPay', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'BuildPay';
  const options = {
    body: payload.body || 'Mate nove upozorneni',
    icon: payload.icon || '/assets/icons/buildpay-192.png',
    badge: payload.badge || '/assets/icons/buildpay-192.png',
    data: payload.data || { url: '/' },
    tag: payload.tag || 'buildpay-notification',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url.includes(self.location.origin));
    const target = event.notification.data?.url || '/';
    return existing ? existing.focus() : clients.openWindow(target);
  }));
});
