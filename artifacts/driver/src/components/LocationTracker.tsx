// ============================================================
// MCC Driver — LocationTracker
// ============================================================
// App-level component (mounted once in App.tsx alongside
// <ActiveRideWatcher />) that owns the geolocation watch
// lifecycle for the signed-in driver. Lives outside the route
// tree so it keeps running when the driver navigates between
// Home, Navigate, Ride Complete, etc. — without this, the
// watch would tear down whenever the screen that started it
// unmounted, breaking mid-ride background updates.
//
// Tracking profiles:
//   - idle (online, no active ride): low-power, 30 s broadcast
//   - active (offered/accepted/navigating/arrived/in_progress
//     /completing): high-accuracy, 12 s broadcast
//   - off (offline): no watch, no broadcast
// ============================================================

import { useEffect, useRef } from 'react';
import { supabase } from '@/services/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useDriverStatusStore } from '@/store/driverStatusStore';
import { useDispatchStore } from '@/store/dispatchStore';
import { logger } from '@/services/telemetry/logger';
import {
  startWatching,
  type LocationFix,
  type WatchHandle,
} from '@/services/location';
import { ensureWhileInUsePermission } from '@/services/location/permissionFlow';

const IDLE_BROADCAST_MS = 30_000;
const IDLE_HIGH_ACCURACY = false;
const ACTIVE_BROADCAST_MS = 12_000;
const ACTIVE_HIGH_ACCURACY = true;

const ACTIVE_STAGES = new Set<string>([
  'offered',
  'accepted',
  'navigating',
  'arrived',
  'in_progress',
  'completing',
]);

type TrackingMode = 'idle' | 'active';

export function LocationTracker() {
  const { driver } = useAuth();
  const driverId = driver?.id ?? null;
  const isOnline = useDriverStatusStore((s) => s.isOnline);
  const setLocation = useDriverStatusStore((s) => s.setLocation);
  const setLocationError = useDriverStatusStore((s) => s.setLocationError);
  const stage = useDispatchStore((s) => s.stage);

  const watchRef = useRef<WatchHandle | null>(null);
  const broadcastRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLocRef = useRef<LocationFix | null>(null);
  const modeRef = useRef<TrackingMode | null>(null);
  const startingRef = useRef(false);
  const generationRef = useRef(0);
  // If state changes while we're inside an async startTracking(), the new
  // effect run can't start a competing watch (it would race with the
  // in-flight one). Instead, we queue the latest desired mode here and the
  // finally-block of the in-flight start picks it up after returning. This
  // guarantees eventual convergence: tracking will always settle on the
  // most-recently-desired profile rather than being stranded "off" because
  // of an aborted stale start.
  const pendingDesiredRef = useRef<TrackingMode | 'off' | null>(null);

  // Effect orchestrates start/stop/switch based on isOnline + stage. Owning
  // the watch in a ref + cancelling on cleanup keeps things idempotent.
  useEffect(() => {
    const desired: TrackingMode | 'off' =
      !driverId || !isOnline
        ? 'off'
        : ACTIVE_STAGES.has(stage)
          ? 'active'
          : 'idle';

    // If a start is already in flight, just record the latest desired state.
    // The finally block of the in-flight start will converge to it.
    if (startingRef.current) {
      pendingDesiredRef.current = desired;
      return;
    }

    if (desired === 'off') {
      void stopTracking();
      return;
    }

    if (modeRef.current !== desired) {
      void startTracking(desired);
    }

    async function stopTracking() {
      if (watchRef.current) {
        await watchRef.current.cancel();
        watchRef.current = null;
      }
      if (broadcastRef.current) {
        clearInterval(broadcastRef.current);
        broadcastRef.current = null;
      }
      modeRef.current = null;
      lastLocRef.current = null;
    }

    async function startTracking(mode: TrackingMode) {
      if (startingRef.current) return;
      startingRef.current = true;
      // Generation counter guards against async races: if isOnline / stage /
      // driverId change while we're awaiting the permission prompt or the
      // plugin start, the effect cleanup bumps `generationRef` and we bail
      // out of committing this watch.
      const gen = ++generationRef.current;
      const isStale = () => gen !== generationRef.current;
      try {
        const perm = await ensureWhileInUsePermission();
        if (isStale()) return;
        if (perm !== 'granted') {
          setLocationError(
            perm === 'denied'
              ? 'Location permission denied — open Settings to allow location access.'
              : 'Location permission required to go online.',
          );
          return;
        }

        // Tear down any in-flight watch before starting a new one — iOS only
        // honours accuracy/distance filters at start time.
        if (watchRef.current) {
          await watchRef.current.cancel();
          watchRef.current = null;
        }
        if (broadcastRef.current) {
          clearInterval(broadcastRef.current);
          broadcastRef.current = null;
        }
        if (isStale()) return;

        const highAccuracy = mode === 'active' ? ACTIVE_HIGH_ACCURACY : IDLE_HIGH_ACCURACY;
        const broadcastMs = mode === 'active' ? ACTIVE_BROADCAST_MS : IDLE_BROADCAST_MS;

        const handle = await startWatching(
          (fix) => {
            lastLocRef.current = fix;
            setLocation(fix.lat, fix.lng);
          },
          {
            enableHighAccuracy: highAccuracy,
            minIntervalMs: mode === 'active' ? 2000 : 10000,
          },
        );
        if (isStale()) {
          // State changed while we were starting — discard the new watch.
          if (handle) await handle.cancel();
          return;
        }
        if (!handle) {
          setLocationError('Geolocation not available on this device.');
          return;
        }
        watchRef.current = handle;
        modeRef.current = mode;

        broadcastRef.current = setInterval(() => {
          const loc = lastLocRef.current;
          if (loc) void postLocation(driverId!, loc);
        }, broadcastMs);

        logger.info('driver.location_tracking_started', { mode });
      } finally {
        startingRef.current = false;
        // Drain any queued desired-state change that arrived while we were
        // starting — guarantees the tracker converges even if multiple
        // online/stage transitions happened during the await window.
        const queued = pendingDesiredRef.current;
        if (queued !== null) {
          pendingDesiredRef.current = null;
          if (queued === 'off') {
            void stopTracking();
          } else if (modeRef.current !== queued) {
            void startTracking(queued);
          }
        }
      }
    }

    return () => {
      // Invalidate any in-flight startTracking() — its post-await
      // commit will see a stale generation and bail.
      generationRef.current++;
      void stopTracking();
    };
  }, [driverId, isOnline, stage, setLocation, setLocationError]);

  return null;
}

async function postLocation(driverId: string, loc: LocationFix) {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return;
  try {
    const res = await fetch('/api/drivers/me/location', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        lat: loc.lat,
        lng: loc.lng,
        heading: loc.heading,
        accuracy: loc.accuracy,
      }),
    });
    if (!res.ok && res.status !== 202) {
      logger.warn('driver.location_post_failed', { status: res.status, driverId });
    }
  } catch (err) {
    logger.warn('driver.location_post_exception', {
      error: err instanceof Error ? err.message : String(err),
      driverId,
    });
  }
}
