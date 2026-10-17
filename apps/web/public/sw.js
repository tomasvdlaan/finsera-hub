/*
 * The service worker: push, and nothing else (docs/notifications-brief.md N6).
 *
 * There is deliberately no `fetch` handler and no cache. The platform goes to some length to
 * know which build a browser is running (lib/build.ts), and a caching worker is the classic way
 * to serve last week's bundle against this week's API. This worker exists because a push needs
 * somewhere to land when no tab is open — that is all it does.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : 'Finsera' };
  }
  const title = data.title || 'Finsera';
  const url = data.url || '/insights';

  event.waitUntil(
    (async () => {
      // The same tag replaces, rather than stacks: five comments on a task are one notification.
      await self.registration.showNotification(title, {
        tag: data.tag || undefined,
        data: { url, id: data.id || null },
        icon: '/icon-192.png',
        badge: '/icon-192.png',
      });
      // The icon badge on an installed app — the closest thing to a widget the web gets.
      if (typeof data.badge === 'number' && 'setAppBadge' in self.navigator) {
        try {
          if (data.badge > 0) await self.navigator.setAppBadge(data.badge);
          else await self.navigator.clearAppBadge();
        } catch {
          /* not supported here; the notification is what matters */
        }
      }
      // Any open tab refreshes its Inbox number at once.
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const tab of tabs) tab.postMessage({ type: 'notification' });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url = '/insights', id = null } = event.notification.data || {};
  event.waitUntil(
    (async () => {
      const target = new URL(url, self.location.origin).href;
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse an open hub window rather than opening another, and tell it which notification
      // was opened so it can be marked read with the signed-in session.
      const open = tabs.find((t) => new URL(t.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        open.postMessage({ type: 'open', url, id });
        return;
      }
      const opened = await self.clients.openWindow(target + (id ? `${target.includes('?') ? '&' : '?'}notification=${encodeURIComponent(id)}` : ''));
      return opened;
    })(),
  );
});
