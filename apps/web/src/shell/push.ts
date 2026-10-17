import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { notificationsChanged } from './notifications.js';

/**
 * Push, from the browser's side (docs/notifications-brief.md N6 and §4.4).
 *
 * The service worker in /sw.js shows what arrives; everything that needs the signed-in session
 * — subscribing, marking a notification opened — happens here, in the page, because the worker
 * has no access to the token.
 */

export type PushState =
  | 'unsupported' //    no service worker or Push API at all
  | 'needs-install' //  iPhone or iPad in Safari: push exists only for Home Screen apps
  | 'not-configured' // the server has no VAPID keys
  | 'denied' //         the browser was told no; only its own settings can undo that
  | 'off' //            possible, not yet turned on for this device
  | 'on';

export const isIOS = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS reports itself as a Mac; a Mac does not have a touch screen.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** A name for this device in the list, from what the browser says about itself. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua) || isIOS()
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : 'This device';
  const browser = isStandalone()
    ? 'app'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'browser';
  return `${device} · ${browser}`;
}

/** Register the push-only worker. Safe to call on every load; the browser keeps one. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

/** The server's public key, from the base64url it is published in to the bytes subscribe wants. */
const urlBase64ToBytes = (base64: string): ArrayBuffer => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
};

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker?.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function currentEndpoint(): Promise<string | null> {
  try {
    return (await currentSubscription())?.endpoint ?? null;
  } catch {
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!supported) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  const { publicKey } = await api.get<{ publicKey: string | null }>('/core/notifications/push/key');
  if (!publicKey) return 'not-configured';
  if (Notification.permission === 'denied') return 'denied';
  return (await currentSubscription()) ? 'on' : 'off';
}

/**
 * Turn push on for this device. Must run from a tap: iOS refuses a permission request that
 * did not come from one, and every browser treats an unprompted request as abuse.
 */
export async function enablePush(): Promise<PushState> {
  const { publicKey } = await api.get<{ publicKey: string | null }>('/core/notifications/push/key');
  if (!publicKey) return 'not-configured';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(publicKey),
    }));
  const json = subscription.toJSON();
  await api.post('/core/notifications/push/devices', {
    endpoint: json.endpoint,
    keys: json.keys,
    label: deviceLabel(),
  });
  return 'on';
}

/**
 * Stop pushing to this device: on the server first, then the browser's subscription.
 * Called on sign-out — a shared laptop must not go on receiving somebody else's pushes.
 */
export async function forgetThisDevice(): Promise<void> {
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) return;
  await api
    .del('/core/notifications/push/devices', { endpoint: subscription.endpoint })
    .catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}

/**
 * Inside the router: listens to the worker, and handles a cold start from a notification.
 *
 * A tap on a notification with hub already open sends a message here (navigate, mark opened);
 * with nothing open, the worker opens `…?notification=<id>`, and the id is read off the URL
 * once the session exists.
 */
export function PushBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    const opened = (id: unknown) => {
      if (typeof id !== 'string' || !id) return;
      void api
        .post(`/core/notifications/${encodeURIComponent(id)}/opened`, {})
        .then(notificationsChanged)
        .catch(() => undefined);
    };

    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('notification');
    if (fromUrl) {
      opened(fromUrl);
      params.delete('notification');
      const rest = params.toString();
      navigate(`${window.location.pathname}${rest ? `?${rest}` : ''}`, { replace: true });
    }

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string; id?: string } | undefined;
      if (data?.type === 'notification') notificationsChanged();
      if (data?.type === 'open') {
        if (data.url?.startsWith('/')) navigate(data.url);
        opened(data.id);
      }
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [navigate]);

  return null;
}
