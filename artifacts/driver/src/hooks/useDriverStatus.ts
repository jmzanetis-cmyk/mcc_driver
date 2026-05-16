// ============================================================
// MCC Driver — useDriverStatus
// ============================================================
// Thin store accessor + go-online/offline toggle. The actual
// location-tracking lifecycle (watch start/stop, server
// broadcast cadence, accuracy profile by ride stage) lives in
// the app-level <LocationTracker /> component so tracking
// keeps running when the driver navigates away from Home
// (e.g. to /ride/:id/navigate during an active trip).
// ============================================================

import { useCallback, useEffect } from 'react';
import { supabase } from '@/services/supabase/client';
import { useDriverStatusStore } from '@/store/driverStatusStore';
import { logger } from '@/services/telemetry/logger';
import { ensureWhileInUsePermission } from '@/services/location/permissionFlow';
import type { DriverRow } from '@/services/supabase/types';

export function useDriverStatus(driverId: string | null) {
  const store = useDriverStatusStore();

  // One-shot hydration of online state + last known location from Supabase
  // so the UI reflects the current value as soon as auth resolves. Safe to
  // run from any consumer — multiple calls just re-set the same store keys.
  useEffect(() => {
    if (!driverId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('drivers')
        .select('is_online, current_lat, current_lng')
        .eq('id', driverId)
        .single();
      if (cancelled || !data) return;
      const row = data as unknown as Pick<DriverRow, 'is_online' | 'current_lat' | 'current_lng'>;
      store.setOnline(row.is_online);
      // Preserve `0` as a valid coordinate (null/undefined only).
      if (row.current_lat != null && row.current_lng != null) {
        store.setLocation(row.current_lat, row.current_lng);
      }
    })();
    return () => {
      cancelled = true;
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

    const { error } = await supabase
      .from('drivers')
      .update({ is_online: newStatus })
      .eq('id', driverId);

    if (!error) {
      // The app-level <LocationTracker /> watches store.isOnline and starts
      // / stops the geolocation watch accordingly — no work to do here.
      store.setOnline(newStatus);
      logger.info('driver.status_toggled', { online: newStatus });
    }

    store.setToggling(false);
  }, [driverId, store]);

  return {
    isOnline: store.isOnline,
    isToggling: store.isToggling,
    currentLat: store.currentLat,
    currentLng: store.currentLng,
    locationError: store.locationError,
    toggleOnline,
  };
}
