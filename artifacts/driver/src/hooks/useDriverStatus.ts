import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/services/supabase/client';
import { useDriverStatusStore } from '@/store/driverStatusStore';
import { logger } from '@/services/telemetry/logger';
import {
  startWatching,
  type LocationFix,
  type WatchHandle,
} from '@/services/location';
import { ensureWhileInUsePermission } from '@/services/location/permissionFlow';
import type { DriverRow } from '@/services/supabase/types';

// Min cadence at which the device pushes a fix to the server.
// The Capacitor plugin / browser may emit fixes faster than this;
// `startWatching` throttles client-side, and the server further
// coalesces in routes/driverLocation.ts.
const BROADCAST_INTERVAL_MS = 12_000;

export function useDriverStatus(driverId: string | null) {
  const store = useDriverStatusStore();
  const watchRef = useRef<WatchHandle | null>(null);
  const broadcastRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLocRef = useRef<LocationFix | null>(null);

  const stopLocationTracking = useCallback(async () => {
    if (watchRef.current) {
      await watchRef.current.cancel();
      watchRef.current = null;
    }
    if (broadcastRef.current) {
      clearInterval(broadcastRef.current);
      broadcastRef.current = null;
    }
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

  const startLocationTracking = useCallback(async () => {
    // Idempotent — never double-start a watch.
    if (watchRef.current) return;

    const perm = await ensureWhileInUsePermission();
    if (perm !== 'granted') {
      store.setLocationError(
        perm === 'denied'
          ? 'Location permission denied — open Settings to allow location access.'
          : 'Location permission required to go online.',
      );
      return;
    }

    const handle = await startWatching(
      (fix) => {
        lastLocRef.current = fix;
        store.setLocation(fix.lat, fix.lng);
      },
      { enableHighAccuracy: true, minIntervalMs: 2000 },
    );
    if (!handle) {
      store.setLocationError('Geolocation not available on this device.');
      return;
    }
    watchRef.current = handle;

    broadcastRef.current = setInterval(() => {
      const loc = lastLocRef.current;
      if (loc) void postLocation(loc);
    }, BROADCAST_INTERVAL_MS);
  }, [postLocation, store]);

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
        if (row.is_online) void startLocationTracking();
      }
    })();

    return () => {
      cancelled = true;
      void stopLocationTracking();
    };
  }, [driverId]);

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
      if (newStatus) void startLocationTracking();
      else void stopLocationTracking();
    }

    store.setToggling(false);
  }, [driverId, store, startLocationTracking, stopLocationTracking]);

  return {
    isOnline: store.isOnline,
    isToggling: store.isToggling,
    currentLat: store.currentLat,
    currentLng: store.currentLng,
    locationError: store.locationError,
    toggleOnline,
  };
}
