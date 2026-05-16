// ============================================================
// MCC Driver — Native iOS push registration (Capacitor)
// ============================================================
// Requests notification permission via the Capacitor
// PushNotifications plugin, registers the APNs token with the
// MCC API server, and wires up event listeners that re-register
// after a token refresh. No-ops on web (the existing Web Push
// flow in `registerPush.ts` handles browsers).

import { Capacitor } from "@capacitor/core";
import { supabase } from "@/services/supabase/client";
import { logger } from "@/services/telemetry/logger";

let registered = false;
let lastToken: string | null = null;

// ── Permission state persistence ─────────────────────────────────────
// Stored so we (a) don't re-show the rationale to a driver who already
// answered, and (b) can surface "notifications are off" UX elsewhere
// in the app by reading getStoredNotificationPermission().
const PERMISSION_KEY = "mcc.push.permission";
const RATIONALE_KEY = "mcc.push.rationale_shown";

export type StoredPermission = "granted" | "denied" | "prompt" | "unknown";

export function getStoredNotificationPermission(): StoredPermission {
  try {
    const v = localStorage.getItem(PERMISSION_KEY);
    if (v === "granted" || v === "denied" || v === "prompt") return v;
  } catch {
    // localStorage unavailable
  }
  return "unknown";
}

function setStoredPermission(state: StoredPermission): void {
  try {
    localStorage.setItem(PERMISSION_KEY, state);
  } catch {
    // ignore
  }
}

function rationaleAlreadyShown(): boolean {
  try {
    return localStorage.getItem(RATIONALE_KEY) === "1";
  } catch {
    return false;
  }
}

function markRationaleShown(): void {
  try {
    localStorage.setItem(RATIONALE_KEY, "1");
  } catch {
    // ignore
  }
}

const RATIONALE_COPY =
  "My Car Concierge needs to send notifications so you can hear new ride " +
  "requests, pickup updates, and payouts — even when the app is in the " +
  "background or your screen is locked. Without this, you may miss rides.";

/** Show a native confirm dialog explaining why we need notifications.
 * Returns true if the driver chose to continue to the OS prompt. */
async function showRationale(): Promise<boolean> {
  if (rationaleAlreadyShown()) return true;
  markRationaleShown();
  try {
    // window.confirm renders as a native iOS alert inside WKWebView.
    return window.confirm(RATIONALE_COPY);
  } catch {
    return true;
  }
}

async function postToken(token: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) {
    logger.warn("native_push: no session, skipping token register");
    return;
  }
  try {
    const res = await fetch("/api/device-tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        platform: "apns",
        token,
        userAgent: navigator.userAgent,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      logger.error("native_push.register_failed", {
        status: res.status,
        body: errBody.slice(0, 200),
      });
      return;
    }
    lastToken = token;
    logger.info("native_push.registered", { tokenPrefix: token.slice(0, 8) });
  } catch (err) {
    logger.error("native_push.register_exception", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function deleteToken(token: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return;
  try {
    await fetch("/api/device-tokens", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ token }),
    });
  } catch {
    // best-effort
  }
}

/**
 * Request notification permission and register the device's APNs token
 * with the API server. Safe to call multiple times — listeners are only
 * attached once and re-registration on token refresh is automatic.
 */
export async function registerNativePush(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") {
    return;
  }
  try {
    const { PushNotifications } = await import(
      "@capacitor/push-notifications"
    );

    if (!registered) {
      registered = true;
      // Attach listeners *before* register() so the first 'registration'
      // event isn't lost on a fast device.
      await PushNotifications.addListener("registration", (token) => {
        void postToken(token.value);
      });
      await PushNotifications.addListener(
        "registrationError",
        (err) => {
          logger.error("native_push.registration_error", {
            error: err.error,
          });
        },
      );
      await PushNotifications.addListener(
        "pushNotificationReceived",
        (notification) => {
          logger.info("native_push.received_foreground", {
            title: notification.title,
            data: notification.data,
          });
        },
      );
      await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action) => {
          // Deep-link if payload includes a url. The Capacitor router
          // uses BASE_URL as basename, so the URL is the in-app path
          // already prefixed by /driver.
          const url =
            (action.notification?.data as { url?: string } | undefined)?.url;
          if (typeof url === "string" && url.length > 0) {
            window.location.assign(url);
          }
        },
      );
    }

    const perm = await PushNotifications.checkPermissions();
    let granted = perm.receive === "granted";
    if (granted) {
      setStoredPermission("granted");
    } else if (perm.receive === "denied") {
      setStoredPermission("denied");
    } else if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      // Show our in-app rationale before triggering the one-shot iOS prompt.
      const proceed = await showRationale();
      if (!proceed) {
        setStoredPermission("prompt");
        logger.info("native_push.rationale_dismissed");
        return;
      }
      const req = await PushNotifications.requestPermissions();
      granted = req.receive === "granted";
      setStoredPermission(granted ? "granted" : "denied");
    }
    if (!granted) {
      logger.info("native_push.permission_denied");
      return;
    }
    // Triggers the 'registration' event with the APNs token.
    await PushNotifications.register();
  } catch (err) {
    logger.error("native_push.exception", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Revoke the device's APNs token server-side. Called on sign-out.
 */
export async function unregisterNativePush(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") {
    return;
  }
  if (lastToken) {
    await deleteToken(lastToken);
    lastToken = null;
  }
}
