// ============================================================
// MCC Driver — App Status Store (Zustand)
// ============================================================
// Tracks the result of the most recent GET /api/app/status fetch.
// Powers two UI surfaces (ForcedUpdateScreen + OutageBanner) and is
// kept intentionally minimal — this is a launch-storm-resilient
// kill switch, not a feature flag system.
// ============================================================

import { create } from "zustand";

export interface AppStatus {
  minSupportedVersion: string;
  latestVersion: string;
  outageMessage: string | null;
  appStoreUrl: string | null;
}

interface AppStatusState {
  // Null until the first fetch completes. The bridge component
  // renders nothing for status-driven UI until this is populated
  // so we never flash a bogus "must update" screen on launch.
  status: AppStatus | null;
  // Running-app version, populated once on launch from the
  // Capacitor App plugin (native) or the Vite-injected package
  // version (web).
  currentVersion: string;
  // Most recent successful fetch — exposed for diagnostics.
  lastFetchedAt: number | null;
  setStatus: (status: AppStatus) => void;
  setCurrentVersion: (version: string) => void;
}

export const useAppStatusStore = create<AppStatusState>((set) => ({
  status: null,
  currentVersion: "0.0.0",
  lastFetchedAt: null,
  setStatus: (status) => set({ status, lastFetchedAt: Date.now() }),
  setCurrentVersion: (currentVersion) => set({ currentVersion }),
}));
