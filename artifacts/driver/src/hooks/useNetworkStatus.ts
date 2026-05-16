// ============================================================
// MCC Driver — useNetworkStatus
// ============================================================
// Reports whether the device currently has a network connection.
// Native iOS / Capacitor: uses the Capacitor Network plugin
// (reports cellular drops as well as full disconnects).
// Web: falls back to navigator.onLine + the browser's online/
// offline events.
//
// The hook is intentionally lightweight — it's mounted globally
// by OfflineBanner.tsx and consumed by useRealtimeReconnect.ts
// to refresh Supabase channels when the device comes back.
// ============================================================

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Network, type ConnectionStatus } from "@capacitor/network";

export interface NetworkStatus {
  online: boolean;
  /** Capacitor's coarse connection type when available, else 'unknown'. */
  connectionType: ConnectionStatus["connectionType"] | "unknown";
}

const DEFAULT_STATUS: NetworkStatus = {
  // Optimistic default — most launches are online. The first real
  // status update lands within a tick on every platform we ship.
  online: true,
  connectionType: "unknown",
};

let cachedStatus: NetworkStatus = DEFAULT_STATUS;
const listeners = new Set<(s: NetworkStatus) => void>();

function emit(next: NetworkStatus) {
  if (next.online === cachedStatus.online && next.connectionType === cachedStatus.connectionType) {
    return;
  }
  cachedStatus = next;
  for (const fn of listeners) fn(next);
}

// One-time wiring per page load. Both Capacitor and browser listeners
// are attached so the hook works on web preview AND native iOS.
let wired = false;
function ensureWired() {
  if (wired) return;
  wired = true;

  if (Capacitor.isNativePlatform()) {
    // Seed with the current status, then subscribe.
    void Network.getStatus()
      .then((s) =>
        emit({ online: s.connected, connectionType: s.connectionType }),
      )
      .catch(() => {});
    void Network.addListener("networkStatusChange", (s) => {
      emit({ online: s.connected, connectionType: s.connectionType });
    });
    return;
  }

  // Web fallback — navigator.onLine + browser events. Treat
  // `navigator.onLine === false` as authoritative; `true` only
  // means "no obvious loss of network" (per WHATWG), but it's the
  // best signal we have without a server reachability ping.
  if (typeof navigator !== "undefined") {
    emit({
      online: navigator.onLine !== false,
      connectionType: "unknown",
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", () =>
      emit({ online: true, connectionType: "unknown" }),
    );
    window.addEventListener("offline", () =>
      emit({ online: false, connectionType: "unknown" }),
    );
  }
}

export function useNetworkStatus(): NetworkStatus {
  ensureWired();
  const [status, setStatus] = useState<NetworkStatus>(cachedStatus);
  useEffect(() => {
    listeners.add(setStatus);
    // Re-sync in case the cached value changed between render + mount.
    setStatus(cachedStatus);
    return () => {
      listeners.delete(setStatus);
    };
  }, []);
  return status;
}

/** Read the current status without subscribing (for one-shot checks). */
export function getNetworkStatus(): NetworkStatus {
  ensureWired();
  return cachedStatus;
}

/**
 * Subscribe to network-back transitions (offline → online). Used by
 * realtime + query layers to trigger a fast resync when the device
 * reconnects, without each subscriber re-deriving the edge itself.
 * Returns an unsubscribe function.
 */
export function onNetworkRestored(cb: () => void): () => void {
  ensureWired();
  let wasOnline = cachedStatus.online;
  const listener = (s: NetworkStatus) => {
    if (!wasOnline && s.online) cb();
    wasOnline = s.online;
  };
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
