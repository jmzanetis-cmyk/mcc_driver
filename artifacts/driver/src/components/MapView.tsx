import React, { useEffect, useRef, useState } from 'react';
import { getMapsLoader } from '@/services/maps/mapsLoader';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapViewProps {
  center: LatLng | null;
  driverPosition?: LatLng | null;
  /** Secondary vehicle position shown as a gold dot (chase driver in tandem rides). */
  partnerPosition?: LatLng | null;
  destinations?: Array<LatLng & { label?: string }>;
  routePolyline?: LatLng[];
  zoom?: number;
  /** Override theme. If omitted, follows the document `data-theme` attribute. */
  theme?: 'dark' | 'light';
  style?: React.CSSProperties;
}

// MCC navy (#1B2A4A) as the geometry base with complementary dark tones
const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1B2A4A' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a9bb5' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1B2A4A' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#16243e' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#1e3150' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#5d7aa8' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#142035' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2d4a7a' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a9bb5' }] },
  { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ color: '#1B2A4A' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a6690' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#b8cfe8' }] },
  { featureType: 'road.highway', elementType: 'labels.text.stroke', stylers: [{ color: '#1B2A4A' }] },
  { featureType: 'transit.line', elementType: 'geometry', stylers: [{ color: '#253d63' }] },
  { featureType: 'transit.station', elementType: 'geometry', stylers: [{ color: '#253d63' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0c1929' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3d5a7a' }] },
];


function readDocTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

// Fallback center (geographic center of contiguous US) when location is unknown
const FALLBACK_CENTER: LatLng = { lat: 39.5, lng: -98.35 };

export function MapView({
  center,
  driverPosition,
  partnerPosition,
  destinations,
  routePolyline,
  zoom = 14,
  theme,
  style,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const partnerMarkerRef = useRef<google.maps.Marker | null>(null);
  const destMarkersRef = useRef<google.maps.Marker[]>([]);
  const polylineRef = useRef<google.maps.Polyline | null>(null);

  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Effective theme: explicit prop wins; otherwise track data-theme attribute
  const [effectiveTheme, setEffectiveTheme] = useState<'dark' | 'light'>(
    () => theme ?? readDocTheme(),
  );

  useEffect(() => {
    if (theme !== undefined) {
      setEffectiveTheme(theme);
      return;
    }
    setEffectiveTheme(readDocTheme());
    const observer = new MutationObserver(() => setEffectiveTheme(readDocTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, [theme]);

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current) return;
    const loader = getMapsLoader();
    if (!loader) {
      setLoadError('Google Maps API key is not configured.');
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await loader.load();
        if (cancelled || !containerRef.current) return;

        const map = new google.maps.Map(containerRef.current, {
          center: center ?? FALLBACK_CENTER,
          zoom,
          styles: effectiveTheme === 'dark' ? DARK_MAP_STYLES : [],
          disableDefaultUI: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
        });

        mapRef.current = map;
        setReady(true);
      } catch {
        if (!cancelled) setLoadError('Failed to load map. Check your connection.');
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // Apply theme changes after init
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    mapRef.current.setOptions({
      styles: effectiveTheme === 'dark' ? DARK_MAP_STYLES : [],
    });
  }, [ready, effectiveTheme]);

  // Pan to updated center
  useEffect(() => {
    if (!ready || !mapRef.current || !center) return;
    mapRef.current.panTo(center);
  }, [ready, center]);

  // Zoom level
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    mapRef.current.setZoom(zoom);
  }, [ready, zoom]);

  // Driver position — blue pulsing dot
  useEffect(() => {
    if (!ready || !mapRef.current) return;

    if (!driverPosition) {
      driverMarkerRef.current?.setMap(null);
      driverMarkerRef.current = null;
      return;
    }

    const icon: google.maps.Symbol = {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 9,
      fillColor: '#3B82F6',
      fillOpacity: 1,
      strokeColor: '#FFFFFF',
      strokeWeight: 2.5,
    };

    if (driverMarkerRef.current) {
      driverMarkerRef.current.setPosition(driverPosition);
    } else {
      driverMarkerRef.current = new google.maps.Marker({
        position: driverPosition,
        map: mapRef.current,
        icon,
        title: 'Your position',
        zIndex: 10,
        optimized: false,
      });
    }
  }, [ready, driverPosition]);

  // Partner position — gold dot (chase driver)
  useEffect(() => {
    if (!ready || !mapRef.current) return;

    if (!partnerPosition) {
      partnerMarkerRef.current?.setMap(null);
      partnerMarkerRef.current = null;
      return;
    }

    const icon: google.maps.Symbol = {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 9,
      fillColor: '#C9982E',
      fillOpacity: 1,
      strokeColor: '#FFFFFF',
      strokeWeight: 2.5,
    };

    if (partnerMarkerRef.current) {
      partnerMarkerRef.current.setPosition(partnerPosition);
    } else {
      partnerMarkerRef.current = new google.maps.Marker({
        position: partnerPosition,
        map: mapRef.current,
        icon,
        title: 'Chase vehicle',
        zIndex: 9,
        optimized: false,
      });
    }
  }, [ready, partnerPosition]);

  // Destination pin(s)
  useEffect(() => {
    if (!ready || !mapRef.current) return;

    destMarkersRef.current.forEach((m) => m.setMap(null));
    destMarkersRef.current = [];

    if (!destinations?.length) return;

    destMarkersRef.current = destinations.map((dest, i) =>
      new google.maps.Marker({
        position: { lat: dest.lat, lng: dest.lng },
        map: mapRef.current!,
        title: dest.label ?? `Stop ${i + 1}`,
        zIndex: 5,
      }),
    );
  }, [ready, destinations]);

  // Route polyline
  useEffect(() => {
    if (!ready || !mapRef.current) return;

    polylineRef.current?.setMap(null);
    polylineRef.current = null;

    if (!routePolyline?.length) return;

    polylineRef.current = new google.maps.Polyline({
      path: routePolyline,
      geodesic: true,
      strokeColor: '#C9982E',
      strokeOpacity: 0.9,
      strokeWeight: 4,
      map: mapRef.current,
    });
  }, [ready, routePolyline]);

  // Cleanup markers/polyline on unmount
  useEffect(() => {
    return () => {
      driverMarkerRef.current?.setMap(null);
      partnerMarkerRef.current?.setMap(null);
      destMarkersRef.current.forEach((m) => m.setMap(null));
      polylineRef.current?.setMap(null);
    };
  }, []);

  return (
    <div
      role="region"
      aria-label="Driver location map"
      style={{
        position: 'relative',
        background: '#1B2A4A',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {!ready && !loadError && (
        <div
          aria-busy="true"
          aria-label="Loading map"
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#1B2A4A',
          }}
        >
          <svg
            width={28} height={28} viewBox="0 0 24 24"
            style={{ animation: 'spin 0.8s linear infinite' }}
            aria-hidden="true"
          >
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(201,152,46,0.25)" strokeWidth="3" strokeDasharray="32" strokeLinecap="round" />
            <circle cx="12" cy="12" r="10" fill="none" stroke="#C9982E" strokeWidth="3" strokeDasharray="32" strokeDashoffset="24" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#1B2A4A',
          }}
        >
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', textAlign: 'center', padding: '0 24px' }}>
            {loadError}
          </span>
        </div>
      )}
    </div>
  );
}
