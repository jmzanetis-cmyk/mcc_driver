// ============================================================
// MCC Driver — Location Service
// ============================================================
// Single wrapper around the Capacitor Geolocation plugin (with
// a `navigator.geolocation` fallback for the web build). All
// location callers in the app must go through this service —
// direct `navigator.geolocation` usage is forbidden so the
// native iOS background-location pipeline stays consistent.
// ============================================================

import { Capacitor } from "@capacitor/core";
import { logger } from "@/services/telemetry/logger";

export interface LocationFix {
  lat: number;
  lng: number;
  heading: number | null;
  accuracy: number | null;
  timestamp: number;
}

export type PermissionState = "granted" | "denied" | "prompt" | "unavailable";

export interface WatchOptions {
  enableHighAccuracy?: boolean;
  /** Minimum time between callbacks (ms). The plugin/browser may emit faster. */
  minIntervalMs?: number;
  onError?: (err: { code: string; message: string }) => void;
}

export type WatchHandle = { id: string | number; cancel: () => Promise<void> };

const isNative = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

// ── Permission ────────────────────────────────────────────────────────────────

export async function checkPermission(): Promise<PermissionState> {
  if (isNative()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const r = await Geolocation.checkPermissions();
      // The plugin returns 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'
      const v = r.location;
      if (v === "granted") return "granted";
      if (v === "denied") return "denied";
      return "prompt";
    } catch (err) {
      logger.error("location.check_permission_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return "unavailable";
    }
  }
  // Web — best-effort via Permissions API.
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return "unavailable";
  }
  try {
    const status = await navigator.permissions?.query({
      name: "geolocation" as PermissionName,
    });
    if (!status) return "prompt";
    if (status.state === "granted") return "granted";
    if (status.state === "denied") return "denied";
    return "prompt";
  } catch {
    return "prompt";
  }
}

/**
 * Request "while-in-use" location permission. Safe to call when
 * already granted (returns 'granted' without re-prompting).
 *
 * Upgrading to "Always" on iOS is handled by the OS once the app
 * actually uses background location with `UIBackgroundModes=location`
 * enabled — there is no explicit programmatic "request always" call
 * in @capacitor/geolocation; iOS will surface its own upgrade prompt
 * after a few minutes of sustained background tracking.
 */
export async function requestPermission(): Promise<PermissionState> {
  if (isNative()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const r = await Geolocation.requestPermissions({
        permissions: ["location"],
      });
      if (r.location === "granted") return "granted";
      if (r.location === "denied") return "denied";
      return "prompt";
    } catch (err) {
      logger.error("location.request_permission_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return "unavailable";
    }
  }
  // Web — `getCurrentPosition` triggers the browser prompt.
  return new Promise<PermissionState>((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve("unavailable");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"),
      (err) => resolve(err.code === err.PERMISSION_DENIED ? "denied" : "prompt"),
      { timeout: 15000 },
    );
  });
}

// ── One-shot read ─────────────────────────────────────────────────────────────

export async function getCurrent(): Promise<LocationFix | null> {
  if (isNative()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
      });
      return toFix(pos);
    } catch (err) {
      logger.warn("location.get_current_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
  return new Promise<LocationFix | null>((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(toFix(pos)),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 },
    );
  });
}

interface PositionLike {
  coords: {
    latitude: number;
    longitude: number;
    heading: number | null;
    accuracy: number;
  };
  timestamp: number;
}

function toFix(pos: PositionLike): LocationFix {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    heading: pos.coords.heading ?? null,
    accuracy: pos.coords.accuracy ?? null,
    timestamp: pos.timestamp,
  };
}

// ── Continuous watch ──────────────────────────────────────────────────────────

export async function startWatching(
  onFix: (fix: LocationFix) => void,
  opts: WatchOptions = {},
): Promise<WatchHandle | null> {
  const minInterval = opts.minIntervalMs ?? 0;
  let last = 0;
  const throttled = (fix: LocationFix) => {
    const now = Date.now();
    if (minInterval > 0 && now - last < minInterval) return;
    last = now;
    onFix(fix);
  };

  if (isNative()) {
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const id = await Geolocation.watchPosition(
        { enableHighAccuracy: opts.enableHighAccuracy ?? true },
        (pos, err) => {
          if (err) {
            opts.onError?.({ code: "watch_error", message: err.message });
            return;
          }
          if (pos) throttled(toFix(pos));
        },
      );
      return {
        id,
        cancel: async () => {
          try {
            await Geolocation.clearWatch({ id });
          } catch {
            // ignore
          }
        },
      };
    } catch (err) {
      logger.error("location.watch_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return null;
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => throttled(toFix(pos)),
    (err) =>
      opts.onError?.({ code: String(err.code), message: err.message }),
    {
      enableHighAccuracy: opts.enableHighAccuracy ?? true,
      maximumAge: 3000,
      timeout: 15000,
    },
  );
  return {
    id,
    cancel: async () => {
      navigator.geolocation.clearWatch(id);
    },
  };
}

export function isNativeLocation(): boolean {
  return isNative();
}
