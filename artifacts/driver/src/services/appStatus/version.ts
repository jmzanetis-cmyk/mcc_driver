// Resolve the running app version.
// - Native iOS: read from the bundle via Capacitor's App plugin
//   (CFBundleShortVersionString).
// - Web/dev preview: fall back to the Vite-injected package version
//   (see vite.config.ts `define`).

import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";

// Injected at build time by Vite's `define`. Falls back to "0.0.0"
// so a missing define never crashes the launch path.
declare const __APP_VERSION__: string;

export async function resolveCurrentAppVersion(): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      const info = await CapacitorApp.getInfo();
      if (info?.version) return info.version;
    } catch {
      // fall through to define-injected value
    }
  }
  try {
    return typeof __APP_VERSION__ === "string" && __APP_VERSION__
      ? __APP_VERSION__
      : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
