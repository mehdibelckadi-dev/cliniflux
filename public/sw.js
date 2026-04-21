self.addEventListener('push', e => {
  let data = { title: '💬 Cliniflux', body: 'Nuevo mensaje', url: '/dashboard' };
  try { data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: data.url },
    vibrate: [200, 100, 200],
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const dash = list.find(c => c.url.includes('/dashboard'));
    if (dash) return dash.focus();
    return clients.openWindow(e.notification.data?.url || '/dashboard');
  }));
});
