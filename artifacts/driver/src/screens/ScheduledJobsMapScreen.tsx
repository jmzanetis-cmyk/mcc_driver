// ============================================================
// MCC Driver — Scheduled Jobs Map Screen
// Full-screen dark map showing available scheduled rides nearby.
// Gold fare pins → tap to reveal details → reserve the job.
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMapsLoader } from '@/services/maps/mapsLoader';
import { useAuth } from '@/hooks/useAuth';
import { useDriverStatusStore } from '@/store/driverStatusStore';
import { supabase } from '@/services/supabase/client';
import { apiUrl } from '@/services/api/baseUrl';
import { colors, borderRadius } from '@/theme';
import { formatCurrency, formatDate, formatTime, formatDistance } from '@/utils/formatters';
import { Button, Spinner } from '@/components';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScheduledJob {
  id: string;
  scenario: string;
  tier: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  scheduledAt: string;
  estimatedFare: number;
  estimatedDistanceMiles: number;
  serviceType: string;
  multiplierRate: number | null;
  multiplierLabel: string | null;
}

type DateFilter = 'all' | 'today' | 'tomorrow' | 'week';

// ── Dark map styles (matches MapView.tsx) ─────────────────────────────────────

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
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a6690' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#b8cfe8' }] },
  { featureType: 'transit.line', elementType: 'geometry', stylers: [{ color: '#253d63' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0c1929' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#3d5a7a' }] },
];

// ── Fare pin helpers ──────────────────────────────────────────────────────────

function buildFarePinSvg(fareDollars: number, selected: boolean): string {
  const label = `$${fareDollars}`;
  const w = Math.max(52, label.length * 8 + 22);
  const h = 30;
  const pinH = 7;
  const cx = w / 2;
  const stroke = selected ? '#ffffff' : 'rgba(27,42,74,0.6)';
  const sw = selected ? 2.5 : 1.5;
  // Slightly larger when selected
  const opacity = selected ? '1' : '0.92';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h + pinH}" opacity="${opacity}">
    <rect x="${sw / 2}" y="${sw / 2}" width="${w - sw}" height="${h - sw}" rx="${(h - sw) / 2}"
      fill="#C9A84C" stroke="${stroke}" stroke-width="${sw}"/>
    <polygon points="${cx - 5},${h - 1} ${cx + 5},${h - 1} ${cx},${h + pinH - 1}" fill="#C9A84C"/>
    <text x="${cx}" y="${h / 2 + 5}" text-anchor="middle"
      fill="#1B2A4A" font-family="-apple-system,BlinkMacSystemFont,Helvetica,sans-serif"
      font-size="13" font-weight="700" letter-spacing="-0.3">${label}</text>
  </svg>`;
}

function makePinIcon(fareDollars: number, selected: boolean): google.maps.Icon {
  const label = `$${fareDollars}`;
  const w = Math.max(52, label.length * 8 + 22);
  const totalH = 37; // h(30) + pinH(7)
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(buildFarePinSvg(fareDollars, selected))}`,
    size: new google.maps.Size(w, totalH),
    anchor: new google.maps.Point(w / 2, totalH),
    scaledSize: new google.maps.Size(w, totalH),
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScheduledJobsMapScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const currentLat = useDriverStatusStore((s) => s.currentLat);
  const currentLng = useDriverStatusStore((s) => s.currentLng);

  // Map refs
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const driverMarkerRef = useRef<google.maps.Marker | null>(null);
  const jobMarkersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  // Data
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Selection & reservation
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reservedIds, setReservedIds] = useState<Set<string>>(new Set());
  const [reserving, setReserving] = useState(false);
  const [reserveError, setReserveError] = useState<string | null>(null);

  // Filters
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [minFareDollars, setMinFareDollars] = useState(0);
  const [airportOnly, setAirportOnly] = useState(false);

  const selectedJob = jobs.find((j) => j.id === selectedId) ?? null;
  const displayJobs = jobs.filter((j) => !reservedIds.has(j.id));

  // ── Map init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const loader = getMapsLoader();
    if (!loader) {
      setMapError('Google Maps API key is not configured.');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        await loader.load();
        if (cancelled || !containerRef.current) return;

        const map = new google.maps.Map(containerRef.current, {
          center: currentLat != null && currentLng != null
            ? { lat: currentLat, lng: currentLng }
            : { lat: 39.5, lng: -98.35 },
          zoom: 11,
          styles: DARK_MAP_STYLES,
          disableDefaultUI: true,
          gestureHandling: 'greedy',
          clickableIcons: false,
        });

        map.addListener('click', () => setSelectedId(null));
        mapRef.current = map;
        setMapReady(true);
      } catch {
        if (!cancelled) setMapError('Failed to load map. Check your connection.');
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch jobs ──────────────────────────────────────────────────────────────
  const fetchJobs = useCallback(async () => {
    if (!driver) return;
    setLoading(true);
    setFetchError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams();
      if (currentLat != null) params.set('lat', String(currentLat));
      if (currentLng != null) params.set('lng', String(currentLng));
      if (dateFilter !== 'all') params.set('date', dateFilter);
      if (minFareDollars > 0) params.set('minFare', String(minFareDollars));
      if (airportOnly) params.set('airportOnly', 'true');

      const res = await fetch(apiUrl(`/transport/scheduled-available?${params.toString()}`), {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (!res.ok) {
        setFetchError('Failed to load available jobs');
        return;
      }
      const data = await res.json() as { jobs: ScheduledJob[] };
      setJobs(data.jobs ?? []);
    } catch {
      setFetchError('Check your connection and try again');
    } finally {
      setLoading(false);
    }
  }, [driver?.id, currentLat, currentLng, dateFilter, minFareDollars, airportOnly]);

  useEffect(() => { void fetchJobs(); }, [fetchJobs]);

  // ── Rebuild markers when jobs or map changes ────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    // Clear old markers
    jobMarkersRef.current.forEach((m) => m.setMap(null));
    jobMarkersRef.current.clear();

    const map = mapRef.current;
    const bounds = new google.maps.LatLngBounds();
    let hasBounds = false;

    displayJobs.forEach((job) => {
      const fareDollars = Math.round(job.estimatedFare);
      const isSelected = selectedId === job.id;
      const marker = new google.maps.Marker({
        position: { lat: job.pickupLat, lng: job.pickupLng },
        map,
        icon: makePinIcon(fareDollars, isSelected),
        title: formatCurrency(job.estimatedFare),
        zIndex: isSelected ? 10 : 5,
        optimized: false,
      });
      marker.addListener('click', () => setSelectedId(job.id));
      jobMarkersRef.current.set(job.id, marker);
      bounds.extend({ lat: job.pickupLat, lng: job.pickupLng });
      hasBounds = true;
    });

    if (currentLat != null && currentLng != null) {
      bounds.extend({ lat: currentLat, lng: currentLng });
    }

    if (hasBounds) {
      map.fitBounds(bounds, { top: 160, right: 24, bottom: 200, left: 24 });
    } else if (currentLat != null && currentLng != null) {
      map.setCenter({ lat: currentLat, lng: currentLng });
      map.setZoom(12);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, jobs, reservedIds]);

  // ── Update selected pin icon without full rebuild ───────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    jobMarkersRef.current.forEach((marker, id) => {
      const job = jobs.find((j) => j.id === id);
      if (!job) return;
      marker.setIcon(makePinIcon(Math.round(job.estimatedFare), selectedId === id));
      marker.setZIndex(selectedId === id ? 10 : 5);
    });
  }, [selectedId, mapReady]);

  // ── Driver position marker ──────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    if (currentLat == null || currentLng == null) {
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
      driverMarkerRef.current.setPosition({ lat: currentLat, lng: currentLng });
    } else {
      driverMarkerRef.current = new google.maps.Marker({
        position: { lat: currentLat, lng: currentLng },
        map: mapRef.current,
        icon,
        title: 'Your position',
        zIndex: 20,
        optimized: false,
      });
    }
  }, [mapReady, currentLat, currentLng]);

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      driverMarkerRef.current?.setMap(null);
      jobMarkersRef.current.forEach((m) => m.setMap(null));
    };
  }, []);

  // ── Reserve ─────────────────────────────────────────────────────────────────
  const handleReserve = async (rideId: string) => {
    setReserving(true);
    setReserveError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(apiUrl(`/transport/scheduled/${rideId}/reserve`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) {
        setReservedIds((prev) => { const s = new Set(prev); s.add(rideId); return s; });
        setJobs((prev) => prev.filter((j) => j.id !== rideId));
        setTimeout(() => setSelectedId(null), 700);
      } else {
        const j = await res.json().catch(() => ({})) as { error?: string };
        setReserveError(j.error ?? 'Failed to reserve job. Try again.');
      }
    } catch {
      setReserveError('Check your connection and try again.');
    } finally {
      setReserving(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', height: '100vh', overflow: 'hidden', background: '#0F1923' }}>

      {/* Map container */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* Loading / error overlays */}
      {!mapReady && !mapError && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center', background: '#0F1923',
        }}>
          <Spinner size={32} color={colors.gold} />
        </div>
      )}
      {mapError && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', background: '#0F1923', padding: 32,
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🗺️</div>
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>
            {mapError}
          </div>
          <button
            onClick={() => navigate('/home')}
            style={{
              marginTop: 20, padding: '10px 20px', borderRadius: borderRadius.full,
              background: colors.gold, color: colors.navy, border: 'none', cursor: 'pointer',
              fontWeight: 700, fontSize: 14, fontFamily: 'inherit',
            }}
          >
            Go Back
          </button>
        </div>
      )}

      {/* ── Top controls ──────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        background: 'linear-gradient(180deg, rgba(15,25,35,0.97) 60%, transparent 100%)',
        padding: '52px 16px 22px',
        pointerEvents: 'none',
      }}>
        {/* Back + title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, pointerEvents: 'auto' }}>
          <button
            onClick={() => navigate('/home')}
            aria-label="Back"
            style={{
              width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, fontFamily: 'inherit',
            }}
          >
            ←
          </button>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#fff', flex: 1 }}>
            Available Scheduled Jobs
          </span>
          {loading ? (
            <Spinner size={14} color={colors.gold} />
          ) : (
            <span style={{
              fontSize: 12, fontWeight: 700, color: colors.gold,
              background: 'rgba(201,168,76,0.18)', padding: '3px 10px', borderRadius: 99,
              flexShrink: 0,
            }}>
              {displayJobs.length}
            </span>
          )}
        </div>

        {/* Date filter chips */}
        <div
          style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none', pointerEvents: 'auto' }}
        >
          {(['all', 'today', 'tomorrow', 'week'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDateFilter(d)}
              style={{
                padding: '6px 14px', borderRadius: 99, border: 'none', cursor: 'pointer', flexShrink: 0,
                background: dateFilter === d ? colors.gold : 'rgba(255,255,255,0.12)',
                color: dateFilter === d ? colors.navy : 'rgba(255,255,255,0.9)',
                fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {d === 'all' ? 'All Dates' : d === 'today' ? 'Today' : d === 'tomorrow' ? 'Tomorrow' : 'This Week'}
            </button>
          ))}
        </div>

        {/* Min fare + airport row */}
        <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', pointerEvents: 'auto' }}>
          <div style={{ flex: 1, display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', flexShrink: 0, whiteSpace: 'nowrap' }}>
              Min fare
            </span>
            <input
              type="range"
              min="0" max="200" step="10"
              value={minFareDollars}
              onChange={(e) => setMinFareDollars(parseInt(e.target.value))}
              style={{ flex: 1, accentColor: colors.gold, cursor: 'pointer' }}
              aria-label={`Minimum fare: ${minFareDollars > 0 ? `$${minFareDollars}` : 'Any'}`}
            />
            <span style={{ fontSize: 12, fontWeight: 700, color: colors.gold, minWidth: 34, flexShrink: 0, textAlign: 'right' }}>
              {minFareDollars > 0 ? `$${minFareDollars}` : 'Any'}
            </span>
          </div>
          <button
            onClick={() => setAirportOnly((a) => !a)}
            style={{
              padding: '5px 11px', borderRadius: 99, border: 'none', cursor: 'pointer', flexShrink: 0,
              background: airportOnly ? colors.gold : 'rgba(255,255,255,0.12)',
              color: airportOnly ? colors.navy : 'rgba(255,255,255,0.9)',
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
            }}
          >
            ✈ Airport
          </button>
        </div>
      </div>

      {/* Fetch error banner */}
      {fetchError && !loading && (
        <div style={{
          position: 'absolute', top: 190, left: 16, right: 16, zIndex: 10,
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
          borderRadius: borderRadius.md, padding: '10px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <span style={{ fontSize: 12, color: '#FCA5A5' }}>{fetchError}</span>
          <button
            onClick={() => { void fetchJobs(); }}
            style={{
              fontSize: 12, fontWeight: 600, color: colors.gold, background: 'transparent',
              border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state pill */}
      {!loading && displayJobs.length === 0 && mapReady && !fetchError && (
        <div style={{
          position: 'absolute', bottom: 48, left: '50%', transform: 'translateX(-50%)', zIndex: 10,
          background: 'rgba(15,25,35,0.92)', borderRadius: 99, padding: '12px 22px',
          backdropFilter: 'blur(10px)', whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)' }}>
            No jobs match your filters — try All Dates
          </span>
        </div>
      )}

      {/* Count hint pill (no selection) */}
      {!loading && displayJobs.length > 0 && !selectedId && (
        <div style={{
          position: 'absolute', bottom: 48, left: '50%', transform: 'translateX(-50%)', zIndex: 10,
          background: 'rgba(15,25,35,0.88)', borderRadius: 99, padding: '10px 20px',
          backdropFilter: 'blur(10px)', whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
            {displayJobs.length} job{displayJobs.length !== 1 ? 's' : ''} nearby — tap a pin
          </span>
        </div>
      )}

      {/* ── Bottom sheet ──────────────────────────────────────────────────── */}
      {selectedJob && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20,
          background: colors.navy,
          borderRadius: `${borderRadius.xl}px ${borderRadius.xl}px 0 0`,
          padding: `20px 20px calc(24px + env(safe-area-inset-bottom, 0px))`,
          boxShadow: '0 -8px 40px rgba(0,0,0,0.55)',
        }}>
          {/* Drag handle */}
          <div style={{
            width: 36, height: 4, background: 'rgba(255,255,255,0.18)',
            borderRadius: 2, margin: '0 auto 18px',
          }} />

          {/* Close */}
          <button
            onClick={() => { setSelectedId(null); setReserveError(null); }}
            aria-label="Close"
            style={{
              position: 'absolute', top: 14, right: 16, width: 28, height: 28,
              borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.65)',
              fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'inherit', lineHeight: 1,
            }}
          >
            ×
          </button>

          {/* Fare + "est. fare" */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 32, fontWeight: 800, color: colors.gold, lineHeight: 1 }}>
              {formatCurrency(selectedJob.estimatedFare)}
            </span>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>estimated</span>
          </div>

          {/* Date/time */}
          <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.88)', marginBottom: 16 }}>
            {formatDate(selectedJob.scheduledAt)} · {formatTime(selectedJob.scheduledAt)}
          </div>

          {/* Route */}
          <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ flexShrink: 0, fontSize: 14 }}>📍</span>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.72)', lineHeight: 1.45 }}>
                {selectedJob.pickupAddress.split(',').slice(0, 2).join(',')}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ flexShrink: 0, fontSize: 14 }}>🏁</span>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.72)', lineHeight: 1.45 }}>
                {selectedJob.dropoffAddress.split(',').slice(0, 2).join(',')}
              </span>
            </div>
          </div>

          {/* Meta row */}
          <div style={{ display: 'flex', gap: 14, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)' }}>
              📏 {formatDistance(selectedJob.estimatedDistanceMiles)}
            </span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.42)', textTransform: 'capitalize' }}>
              🚗 {selectedJob.serviceType}
            </span>
            {selectedJob.multiplierRate != null && selectedJob.multiplierRate > 1 && selectedJob.multiplierLabel && (
              <span style={{
                fontSize: 11, fontWeight: 700, color: colors.gold,
                background: 'rgba(201,168,76,0.15)',
                border: '1px solid rgba(201,168,76,0.3)',
                padding: '2px 8px', borderRadius: 99,
              }}>
                ⚡ {selectedJob.multiplierLabel} +{Math.round((selectedJob.multiplierRate - 1) * 100)}%
              </span>
            )}
          </div>

          {/* Reserve error */}
          {reserveError && (
            <div style={{
              marginBottom: 12, padding: '8px 12px', borderRadius: borderRadius.md,
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
              color: '#FCA5A5', fontSize: 12,
            }}>
              {reserveError}
            </div>
          )}

          {/* Reserve / success state */}
          {reservedIds.has(selectedJob.id) ? (
            <div style={{
              padding: 14, borderRadius: borderRadius.lg, textAlign: 'center',
              background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)',
              color: colors.success, fontWeight: 700, fontSize: 15,
            }}>
              ✓ Job Reserved — check your Schedule
            </div>
          ) : (
            <Button
              onClick={() => { void handleReserve(selectedJob.id); }}
              loading={reserving}
              variant="primary"
              fullWidth
            >
              Reserve This Job
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
