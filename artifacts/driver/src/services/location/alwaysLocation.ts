// ============================================================
// MCC Driver — AlwaysLocation native bridge
// ============================================================
// Thin TS wrapper around the in-app Swift plugin that wraps
// CLLocationManager.requestAlwaysAuthorization(). The official
// @capacitor/geolocation plugin only requests "while in use"
// on iOS, so we ship our own tiny plugin to trigger the iOS
// "Always Allow" upgrade dialog at ride-accept time.
//
// On non-iOS / web, this is a no-op.
// ============================================================

import { Capacitor, registerPlugin } from "@capacitor/core";

export type IosAuthStatus =
  | "notDetermined"
  | "restricted"
  | "denied"
  | "whenInUse"
  | "always"
  | "unknown";

interface AlwaysLocationPlugin {
  requestAlways(): Promise<{ status: IosAuthStatus }>;
  getAuthorizationStatus(): Promise<{ status: IosAuthStatus }>;
}

const AlwaysLocation = registerPlugin<AlwaysLocationPlugin>("AlwaysLocation");

function isIos(): boolean {
  return (
    Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios"
  );
}

/**
 * Trigger iOS' "Always Allow" upgrade prompt. Returns the resulting
 * authorization status. No-op on web/non-iOS (returns `"unknown"`).
 *
 * If the native plugin call rejects on iOS — almost always meaning the
 * AlwaysLocationPlugin Swift class isn't compiled into the app target
 * (project.pbxproj misconfiguration) — we surface that loudly via console
 * so the regression is obvious during device QA.
 */
export async function requestAlwaysAuthorization(): Promise<IosAuthStatus> {
  if (!isIos()) return "unknown";
  try {
    const r = await AlwaysLocation.requestAlways();
    return r.status;
  } catch (err) {
    console.warn(
      "[AlwaysLocation] requestAlways failed — is the native plugin registered?",
      err,
    );
    return "unknown";
  }
}

export async function getIosAuthorizationStatus(): Promise<IosAuthStatus> {
  if (!isIos()) return "unknown";
  try {
    const r = await AlwaysLocation.getAuthorizationStatus();
    return r.status;
  } catch (err) {
    console.warn(
      "[AlwaysLocation] getAuthorizationStatus failed — is the native plugin registered?",
      err,
    );
    return "unknown";
  }
}
