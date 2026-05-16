// ============================================================
// MCC Driver — Location permission UX flow
// ============================================================
// Pre-prompt rationale dialogs so the OS prompt is not the
// first time the driver sees the request. App Review penalises
// raw prompts; a short in-app explanation also boosts grant
// rates. Uses window.confirm (renders as a native iOS alert
// inside the WKWebView).
// ============================================================

import { logger } from "@/services/telemetry/logger";
import {
  checkPermission,
  requestPermission,
  type PermissionState,
} from "./index";
import {
  getIosAuthorizationStatus,
  requestAlwaysAuthorization,
} from "./alwaysLocation";

const WHEN_IN_USE_KEY = "mcc.location.rationale_shown";
const ALWAYS_KEY = "mcc.location.always_rationale_shown";

const WHEN_IN_USE_COPY =
  "My Car Concierge uses your location while you're online so members " +
  "can be matched with the nearest driver and dispatch can see your " +
  "progress. We only track your location while the app is online.";

const ALWAYS_COPY =
  "iOS may now ask whether to keep sharing your location in the " +
  "background. Please allow this — without it, dispatch and the " +
  "member can lose sight of you when your screen locks during a ride.";

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function shownAlready(key: string): boolean {
  return safeGet(key) === "1";
}

function markShown(key: string): void {
  safeSet(key, "1");
}

async function showRationale(copy: string): Promise<boolean> {
  try {
    return window.confirm(copy);
  } catch {
    return true;
  }
}

/**
 * Show the "while in use" rationale (once) and trigger the OS prompt.
 * Returns the resulting permission state. Safe to call repeatedly —
 * if permission is already granted/denied, no prompt is shown.
 */
export async function ensureWhileInUsePermission(): Promise<PermissionState> {
  const current = await checkPermission();
  if (current === "granted" || current === "denied" || current === "unavailable") {
    return current;
  }
  if (!shownAlready(WHEN_IN_USE_KEY)) {
    const proceed = await showRationale(WHEN_IN_USE_COPY);
    if (!proceed) {
      // Don't persist `shown=1` for a dismissed rationale — the driver should
      // see the explanation again next time they try to go online.
      logger.info("location.while_in_use_rationale_dismissed");
      return "prompt";
    }
    markShown(WHEN_IN_USE_KEY);
  }
  const result = await requestPermission();
  logger.info("location.while_in_use_requested", { result });
  return result;
}

/**
 * Show the "always" upgrade rationale and then trigger the iOS
 * "Always Allow" upgrade prompt via the in-app AlwaysLocation
 * plugin. Called once when the driver accepts a ride so background
 * location can keep flowing when the screen is locked.
 *
 * Safe to call repeatedly — the OS call is a no-op once status is
 * already `always`, and the rationale dialog is shown at most once.
 */
export async function announceAlwaysUpgrade(): Promise<void> {
  const current = await getIosAuthorizationStatus();
  if (current === "always") {
    return; // already on Always — no need to nag
  }
  // If the driver previously denied Always (or it's restricted by parental
  // controls / MDM), iOS won't re-prompt programmatically — they have to
  // change it from Settings. Show explicit guidance so they understand why
  // background tracking is degraded mid-ride.
  if (current === "denied" || current === "restricted") {
    logger.warn("location.always_blocked", { current });
    try {
      window.alert(
        "Background location is currently disabled for My Car Concierge. " +
        "While the screen is locked, dispatch and the member can lose sight " +
        "of you. To fix this, open iOS Settings → My Car Concierge → Location " +
        "and choose “Always”.",
      );
    } catch {
      // window.alert can throw in some embedded WebView configs — ignore.
    }
    return;
  }

  if (!shownAlready(ALWAYS_KEY)) {
    const proceed = await showRationale(ALWAYS_COPY);
    if (!proceed) {
      // Don't persist `shown=1` for a dismissed rationale — the driver should
      // see the explanation again on the next active-ride stage entry.
      logger.info("location.always_rationale_dismissed");
      return;
    }
    markShown(ALWAYS_KEY);
  }

  const status = await requestAlwaysAuthorization();
  logger.info("location.always_requested", { status });
  // `"unknown"` on iOS specifically means the native AlwaysLocation plugin
  // is not registered / compiled into the target. Surface as a warning so
  // it isn't silently masked behind a happy-path log.
  if (status === "unknown") {
    logger.warn("location.always_plugin_unavailable");
  }
}
