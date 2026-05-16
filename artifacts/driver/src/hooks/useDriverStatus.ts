import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/services/supabase/client';
import { useDriverStatusStore } from '@/store/driverStatusStore';
import { useDispatchStore } from '@/store/dispatchStore';
import { logger } from '@/services/telemetry/logger';
import {
  startWatching,
  type LocationFix,
  type WatchHandle,
} from '@/services/location';
import { ensureWhileInUsePermission } from '@/services/location/permissionFlow';
import type { DriverRow } from '@/services/supabase/types';

// Two tracking profiles, gated on whether the driver is mid-ride:
//   - idle (online but no active ride): low-power, infrequent updates so
//     dispatch still has a recent fix without burning battery on the home
//     screen and without showing the iOS background-location indicator.
//   - active (offered/accepted/navigating/arrived/in_progress): high-
//     accuracy fixes broadcast every 12 s for the dispatcher + member.
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

export function useDriverStatus(driverId: string | null) {
  const store = useDriverStatusStore();
  const dispatchStage = useDispatchStore((s) => s.stage);
  const watchRef = useRef<WatchHandle | null>(null);
  const broadcastRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLocRef = useRef<LocationFix | null>(null);
  const modeRef = useRef<TrackingMode | null>(null);

  const stopLocationTracking = useCallback(async () => {
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
  }, []);

  const postLocation = useCallback(async (loc: LocationFix) => {
    if (!driverId) return;
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
        logger.warn('driver.location_post_failed', { status: res.status });
      }
    } catch (err) {
      logger.warn('driver.location_post_exception', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [driverId]);

  // Start (or switch to) a tracking profile. Tearing down the previous watch
  // ensures the Capacitor plugin re-issues `startUpdatingLocation` with the
  // new accuracy — iOS only honours accuracy/distance filters at start time.
  const startLocationTracking = useCallback(async (mode: TrackingMode) => {
    if (modeRef.current === mode && watchRef.current) return;

    const perm = await ensureWhileInUsePermission();
    if (perm !== 'granted') {
      store.setLocationError(
        perm === 'denied'
          ? 'Location permission denied — open Settings to allow location access.'
          : 'Location permission required to go online.',
      );
      return;
    }

    // Tear down any in-flight watch before starting a new one with different
    // accuracy / cadence.
    if (watchRef.current) {
      await watchRef.current.cancel();
      watchRef.current = null;
    }
    if (broadcastRef.current) {
      clearInterval(broadcastRef.current);
      broadcastRef.current = null;
    }

    const highAccuracy = mode === 'active' ? ACTIVE_HIGH_ACCURACY : IDLE_HIGH_ACCURACY;
    const broadcastMs = mode === 'active' ? ACTIVE_BROADCAST_MS : IDLE_BROADCAST_MS;

    const handle = await startWatching(
      (fix) => {
        lastLocRef.current = fix;
        store.setLocation(fix.lat, fix.lng);
      },
      {
        enableHighAccuracy: highAccuracy,
        minIntervalMs: mode === 'active' ? 2000 : 10000,
      },
    );
    if (!handle) {
      store.setLocationError('Geolocation not available on this device.');
      return;
    }
    watchRef.current = handle;
    modeRef.current = mode;

    broadcastRef.current = setInterval(() => {
      const loc = lastLocRef.current;
      if (loc) void postLocation(loc);
    }, broadcastMs);

    logger.info('driver.location_tracking_started', { mode });
  }, [postLocation, store]);

  // Initial bootstrap: hydrate online state, kick off tracking if online.
  useEffect(() => {
    if (!driverId) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('drivers')
        .select('is_online, current_lat, current_lng')
        .eq('id', driverId)
        .single();

      if (cancelled) return;
      if (data) {
        const row = data as unknown as Pick<DriverRow, 'is_online' | 'current_lat' | 'current_lng'>;
        store.setOnline(row.is_online);
        if (row.current_lat && row.current_lng) {
          store.setLocation(row.current_lat, row.current_lng);
        }
        if (row.is_online) {
          const mode: TrackingMode = ACTIVE_STAGES.has(dispatchStage) ? 'active' : 'idle';
          void startLocationTracking(mode);
        }
      }
    })();

    return () => {
      cancelled = true;
      void stopLocationTracking();
    };
  }, [driverId]);

  // React to ride-stage changes — upgrade to high-accuracy/12 s when an
  // offer/active stage starts, downgrade back to idle profile when the
  // ride finishes or is cancelled. No-op when the driver is offline.
  useEffect(() => {
    if (!store.isOnline) return;
    const desired: TrackingMode = ACTIVE_STAGES.has(dispatchStage) ? 'active' : 'idle';
    if (modeRef.current === desired) return;
    void startLocationTracking(desired);
  }, [dispatchStage, store.isOnline, startLocationTracking]);

  const toggleOnline = useCallback(async () => {
    if (!driverId) return;
    store.setToggling(true);

    const newStatus = !store.isOnline;

    // If going online, prompt for & verify location permission BEFORE flipping
    // the DB flag — there's no point being "online" without a location fix.
    if (newStatus) {
      const perm = await ensureWhileInUsePermission();
      if (perm !== 'granted') {
        store.setToggling(false);
        store.setLocationError(
          perm === 'denied'
            ? 'Location permission denied — open Settings to allow location access.'
            : 'Location permission required to go online.',
        );
        return;
      }
    }

    const { error } = await supabase.from('drivers').update({
      is_online: newStatus,
    }).eq('id', driverId);

    if (!error) {
      store.setOnline(newStatus);
      logger.info('driver.status_toggled', { online: newStatus });
      if (newStatus) {
        const mode: TrackingMode = ACTIVE_STAGES.has(dispatchStage) ? 'active' : 'idle';
        void startLocationTracking(mode);
      } else {
        void stopLocationTracking();
      }
    }

    store.setToggling(false);
  }, [driverId, store, dispatchStage, startLocationTracking, stopLocationTracking]);

  return {
    isOnline: store.isOnline,
    isToggling: store.isToggling,
    currentLat: store.currentLat,
    currentLng: store.currentLng,
    locationError: store.locationError,
    toggleOnline,
  };
}
