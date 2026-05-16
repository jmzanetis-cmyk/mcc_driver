// MCC Driver — Push Service Worker
// Receives Web Push messages from the API server and surfaces them as
// real OS notifications so drivers see them even when the app is closed.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_err) {
    payload = { title: 'MCC', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'MCC notification';
  const options = {
    body: payload.body || '',
    data: { url: payload.url || '/driver/', ...(payload.data || {}) },
    icon: '/driver/mcc-driver-logo.png',
    badge: '/driver/favicon.svg',
    tag: payload.event || 'mcc-push',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/driver/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate(targetUrl).catch(() => {});
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      }),
  );
});
