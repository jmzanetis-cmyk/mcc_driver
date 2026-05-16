// ============================================================
// MCC Driver — NetworkResyncBridge
// ============================================================
// Glue between the network-status hook and the rest of the
// app: when the device transitions offline → online, invalidate
// every TanStack Query so stale data refetches immediately,
// and nudge Supabase Realtime to reconnect its socket so any
// missed ride offers / cancellations arrive within ~10 s.
//
// Mounted once at the App root alongside OfflineBanner.
// Renders nothing.
// ============================================================

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { onNetworkRestored } from "@/hooks/useNetworkStatus";
import { supabase } from "@/services/supabase/client";
import { logger } from "@/services/telemetry/logger";

export function NetworkResyncBridge() {
  const qc = useQueryClient();
  useEffect(() => {
    const off = onNetworkRestored(() => {
      logger.info("network.restored.resync");
      // Force-refetch every active query.
      void qc.invalidateQueries();
      // Supabase Realtime keeps an internal heartbeat and will
      // auto-reconnect, but calling connect() is idempotent and
      // closes the gap when the socket is stuck in a back-off.
      try {
        supabase.realtime.connect();
      } catch (err) {
        logger.warn("network.restored.realtime_connect_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
    return off;
  }, [qc]);
  return null;
}
