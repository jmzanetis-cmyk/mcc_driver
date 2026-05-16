// ============================================================
// MCC Driver — Web Push registration
// ============================================================
// Subscribes the current browser to Web Push using the server's
// VAPID public key, then registers the subscription with the
// API server so it can deliver real native push notifications
// even when the driver app is closed.
//
// On sign-out the caller invokes `unregisterPushSubscription()`
// which both unsubscribes locally and tells the server to mark
// the token revoked.

import { supabase } from '@/services/supabase/client';
import { logger } from '@/services/telemetry/logger';
import { apiUrl } from '@/services/api/baseUrl';

const SW_URL = `${import.meta.env.BASE_URL}push-sw.js`;
const SW_SCOPE = import.meta.env.BASE_URL;

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function bufferToBase64(buffer: ArrayBuffer | null): string | null {
  if (!buffer) return null;
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch(apiUrl('/device-tokens/vapid-key'));
    if (!res.ok) return null;
    const json = (await res.json()) as { publicKey?: string };
    return json.publicKey ?? null;
  } catch {
    return null;
  }
}

async function postSubscription(sub: PushSubscription): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return;
  const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } };
  const p256dh = json.keys?.p256dh ?? bufferToBase64(sub.getKey('p256dh'));
  const authKey = json.keys?.auth ?? bufferToBase64(sub.getKey('auth'));
  const res = await fetch(apiUrl('/device-tokens'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      platform: 'web',
      token: sub.endpoint,
      p256dh,
      auth: authKey,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`device-token register failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
}

export async function registerPushSubscription(): Promise<void> {
  if (!pushSupported()) {
    logger.info('push.register.unsupported');
    return;
  }
  try {
    const publicKey = await fetchVapidPublicKey();
    if (!publicKey) {
      logger.info('push.register.skipped_no_vapid');
      return;
    }
    // Ask permission. Browsers require a user gesture for the *initial* prompt
    // in many cases; if the prompt is silently denied we just bail out and try
    // again on the next sign-in.
    let permission = Notification.permission;
    if (permission === 'default') {
      try {
        permission = await Notification.requestPermission();
      } catch {
        return;
      }
    }
    if (permission !== 'granted') {
      logger.info('push.register.permission_not_granted', { permission });
      return;
    }

    const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await postSubscription(sub);
    logger.info('push.register.success', { endpoint: sub.endpoint.slice(0, 40) });
  } catch (err) {
    logger.error('push.register.failed', { error: (err as Error).message });
  }
}

export async function unregisterPushSubscription(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;

    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (accessToken) {
      await fetch(apiUrl('/device-tokens'), {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ token: endpoint }),
      }).catch(() => {});
    }
    await sub.unsubscribe().catch(() => {});
    logger.info('push.unregister.success');
  } catch (err) {
    logger.error('push.unregister.failed', { error: (err as Error).message });
  }
}
