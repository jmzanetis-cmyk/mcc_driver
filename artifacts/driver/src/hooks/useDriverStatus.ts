import { useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/services/supabase/client';
import { useDriverStatusStore } from '@/store/driverStatusStore';
import { logger } from '@/services/telemetry/logger';
import type { DriverRow } from '@/services/supabase/types';

export function useDriverStatus(driverId: string | null) {
  const store = useDriverStatusStore();
  const watchIdRef = useRef<number | null>(null);
  const broadcastRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLocRef = useRef<{ lat: number; lng: number; heading: number } | null>(null);

  useEffect(() => {
    if (!driverId) return;

    (async () => {
      const { data } = await supabase
        .from('drivers')
        .select('is_online, current_lat, current_lng')
        .eq('id', driverId)
        .single();

      if (data) {
        const row = data as unknown as Pick<DriverRow, 'is_online' | 'current_lat' | 'current_lng'>;
        store.setOnline(row.is_online);
        if (row.current_lat && row.current_lng) {
          store.setLocation(row.current_lat, row.current_lng);
        }
        if (row.is_online) startLocationTracking();
      }
    })();

    return () => stopLocationTracking();
  }, [driverId]);

  const startLocationTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
      store.setLocationError('Geolocation not available');
      return;
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          heading: pos.coords.heading ?? 0,
        };
        lastLocRef.current = loc;
        store.setLocation(loc.lat, loc.lng);
      },
      (err) => store.setLocationError(err.message),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );

    broadcastRef.current = setInterval(async () => {
      if (!lastLocRef.current || !driverId) return;
      const loc = lastLocRef.current;

      await supabase.from('drivers').update({
        current_lat: loc.lat,
        current_lng: loc.lng,
        current_heading: loc.heading,
        location_updated_at: new Date().toISOString(),
      }).eq('id', driverId);

      await supabase.from('driver_location_history').insert({
        driver_id: driverId,
        lat: loc.lat,
        lng: loc.lng,
        heading: loc.heading,
      });
    }, 5000);
  }, [driverId]);

  const stopLocationTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (broadcastRef.current) {
      clearInterval(broadcastRef.current);
      broadcastRef.current = null;
    }
  }, []);

  const toggleOnline = useCallback(async () => {
    if (!driverId) return;
    store.setToggling(true);

    const newStatus = !store.isOnline;

    const { error } = await supabase.from('drivers').update({
      is_online: newStatus,
      location_updated_at: new Date().toISOString(),
    }).eq('id', driverId);

    if (!error) {
      store.setOnline(newStatus);
      logger.info('driver.status_toggled', { online: newStatus });
      if (newStatus) startLocationTracking();
      else stopLocationTracking();
    }

    store.setToggling(false);
  }, [driverId, store.isOnline, startLocationTracking, stopLocationTracking]);

  return {
    isOnline: store.isOnline,
    isToggling: store.isToggling,
    currentLat: store.currentLat,
    currentLng: store.currentLng,
    locationError: store.locationError,
    toggleOnline,
  };
}
