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
    markShown(WHEN_IN_USE_KEY);
    const proceed = await showRationale(WHEN_IN_USE_COPY);
    if (!proceed) {
      logger.info("location.while_in_use_rationale_dismissed");
      return "prompt";
    }
  }
  const result = await requestPermission();
  logger.info("location.while_in_use_requested", { result });
  return result;
}

/**
 * Show the "always" upgrade rationale (once) when the driver accepts
 * a ride. iOS itself drives the upgrade prompt after the app uses
 * background location for a few minutes — we just prep the user so
 * they aren't surprised and tap Allow.
 */
export async function announceAlwaysUpgrade(): Promise<void> {
  if (shownAlready(ALWAYS_KEY)) return;
  markShown(ALWAYS_KEY);
  await showRationale(ALWAYS_COPY);
  logger.info("location.always_rationale_shown");
}
