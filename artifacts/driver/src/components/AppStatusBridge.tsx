// Drives the app-status lifecycle:
//   1. On mount, resolve the running app version and stash it in the store.
//   2. Fetch /api/app/status on launch.
//   3. Re-fetch on app resume (Capacitor App.addListener('resume') on
//      native, document visibilitychange on web).
//   4. When the running version is below the server's minimum, render
//      the ForcedUpdateScreen as a full-screen overlay that blocks
//      every other route.
//   5. Always render the OutageBanner (it self-hides when no message).

import React, { useEffect } from "react";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { useAppStatusStore } from "@/store/appStatusStore";
import { fetchAppStatus } from "@/services/appStatus";
import { resolveCurrentAppVersion } from "@/services/appStatus/version";
import { isVersionBelow } from "@/services/appStatus/semver";
import { ForcedUpdateScreen } from "./ForcedUpdateScreen";
import { OutageBanner } from "./OutageBanner";

export function AppStatusBridge({ children }: { children: React.ReactNode }) {
  const status = useAppStatusStore((s) => s.status);
  const currentVersion = useAppStatusStore((s) => s.currentVersion);
  const setCurrentVersion = useAppStatusStore((s) => s.setCurrentVersion);

  useEffect(() => {
    void (async () => {
      const v = await resolveCurrentAppVersion();
      setCurrentVersion(v);
    })();
    void fetchAppStatus();

    let nativeListener: PluginListenerHandle | null = null;
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) void fetchAppStatus();
      })
        .then((handle) => {
          nativeListener = handle;
        })
        .catch(() => {});
    }

    const handleVisibility = () => {
      if (document.visibilityState === "visible") void fetchAppStatus();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (nativeListener) {
        void nativeListener.remove();
      }
    };
  }, [setCurrentVersion]);

  // Block the entire app behind the forced-update screen when needed.
  // We only enforce once we've successfully fetched a status AND know
  // the current version — never on the cold launch frame, so a slow
  // network can't flash an erroneous update screen.
  const mustForceUpdate =
    status !== null &&
    currentVersion !== "0.0.0" &&
    isVersionBelow(currentVersion, status.minSupportedVersion);

  return (
    <>
      <OutageBanner />
      {mustForceUpdate ? (
        <ForcedUpdateScreen
          appStoreUrl={status?.appStoreUrl ?? null}
          currentVersion={currentVersion}
          minSupportedVersion={status?.minSupportedVersion ?? "0.0.0"}
        />
      ) : (
        children
      )}
    </>
  );
}
