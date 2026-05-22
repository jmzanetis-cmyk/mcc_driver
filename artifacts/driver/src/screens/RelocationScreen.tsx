// ============================================================
// MCC Driver — Vehicle Relocation / Concierge Ride Screen
// ============================================================
// Handles vehicle_delivery_solo, vehicle_pickup_solo,
// paired_vehicle_*, concierge_* scenarios.
//
// Flow:
//   1. Pickup photos (6 angles) → uploaded to Supabase Storage
//   2. Navigate to dropoff (with optional chase dot for Tier 3/4)
//   3. Dropoff photos (same angles)
//   4. Confirm delivery → completeRide()
//
// Supabase Storage: create a "relocation-photos" bucket
// (private, 50 MB file limit) in your Supabase dashboard before
// this flow runs in production.
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { supabase } from '@/services/supabase/client';
import { useActiveRide } from '@/hooks/useActiveRide';
import { useDriverStatusStore } from '@/store/driverStatusStore';
import { useDispatchStore } from '@/store/dispatchStore';
import { fetchRoute, type RouteResult } from '@/services/navigation/routeService';
import { openNavigation, getDefaultNavApp, getNavAppName, type NavApp } from '@/services/navigation/navService';
import { MapView, Button, Card, InfoRow, Spinner, PageHeader } from '@/components';
import { colors, borderRadius, withAlpha } from '@/theme';
import { formatCurrency, formatDistance, getScenarioLabel, shortenAddress } from '@/utils/formatters';
import type { LatLng } from '@/components/MapView';

// ── Photo angles required for every relocation job ──────────────────────────

const PHOTO_ANGLES = [
  { id: 'front',          label: 'Front of Vehicle',    icon: '🚗' },
  { id: 'rear',           label: 'Rear of Vehicle',     icon: '🔙' },
  { id: 'driver_side',    label: "Driver's Side",       icon: '◀' },
  { id: 'passenger_side', label: "Passenger's Side",    icon: '▶' },
  { id: 'odometer',       label: 'Odometer',            icon: '🔢' },
  { id: 'dashboard',      label: 'Dashboard',           icon: '📊' },
] as const;

type AngleId = typeof PHOTO_ANGLES[number]['id'];
type PhotoSet = Partial<Record<AngleId, string>>; // angle → dataUrl or objectUrl

type Phase =
  | 'pickup_photos'    // capture pre-pickup condition
  | 'navigating'       // en route to dropoff
  | 'dropoff_photos'   // capture post-dropoff condition
  | 'confirming'       // final confirmation before completing ride
  | 'uploading';       // uploading photos before completing

// ── Scenarios that use this screen ──────────────────────────────────────────

export const RELOCATION_SCENARIOS = new Set([
  'vehicle_delivery_solo',
  'vehicle_pickup_solo',
  'paired_vehicle_delivery',
  'paired_vehicle_pickup',
  'paired_round_trip_shuttle',
  'concierge_dropoff',
  'concierge_pickup',
  'full_concierge_round_trip',
]);

// ── Component ────────────────────────────────────────────────────────────────

export function RelocationScreen() {
  const navigate = useNavigate();
  const { activeRide, startNavigating, markArrived, startRide, completeRide } = useActiveRide();
  const dispatch = useDispatchStore();
  const rideId = useDispatchStore((s) => s.rideId);
  const tier = useDispatchStore((s) => s.tier);

  const currentLat = useDriverStatusStore((s) => s.currentLat);
  const currentLng = useDriverStatusStore((s) => s.currentLng);
  const driverPosition: LatLng | null =
    currentLat != null && currentLng != null ? { lat: currentLat, lng: currentLng } : null;

  const [phase, setPhase] = useState<Phase>('pickup_photos');
  const [pickupPhotos, setPickupPhotos] = useState<PhotoSet>({});
  const [dropoffPhotos, setDropoffPhotos] = useState<PhotoSet>({});
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [partnerPos, setPartnerPos] = useState<LatLng | null>(null);
  const [preferredNav] = useState<NavApp>(() => {
    try { return (localStorage.getItem('mcc_preferred_nav') as NavApp) ?? getDefaultNavApp(); }
    catch { return getDefaultNavApp(); }
  });
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState('');

  // Contact info fetched from ride row
  const [pickupContact, setPickupContact] = useState<{ name: string; phone: string } | null>(null);
  const [dropoffContact, setDropoffContact] = useState<{ name: string; phone: string } | null>(null);

  // Web fallback file input refs (one per angle)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingAngleRef = useRef<{ set: 'pickup' | 'dropoff'; angleId: AngleId } | null>(null);

  // ── Fetch ride contact info ─────────────────────────────────────────────

  useEffect(() => {
    if (!rideId) return;
    void (async () => {
      const { data } = await supabase
        .from('rides')
        .select('pickup_contact_name, pickup_contact_phone, dropoff_contact_name, dropoff_contact_phone, member_phone')
        .eq('id', rideId)
        .maybeSingle();

      if (!data) return;
      const d = data as {
        pickup_contact_name?: string | null;
        pickup_contact_phone?: string | null;
        dropoff_contact_name?: string | null;
        dropoff_contact_phone?: string | null;
        member_phone?: string | null;
      };

      const memberPhone = d.member_phone ?? null;
      setPickupContact({
        name: d.pickup_contact_name ?? 'Pickup Contact',
        phone: d.pickup_contact_phone ?? memberPhone ?? '',
      });
      setDropoffContact({
        name: d.dropoff_contact_name ?? 'Dropoff Contact',
        phone: d.dropoff_contact_phone ?? memberPhone ?? '',
      });
    })();
  }, [rideId]);

  // ── Route fetch (refreshes every 30 s) ─────────────────────────────────

  useEffect(() => {
    if (phase !== 'navigating' || !activeRide) return;
    const dest = { lat: activeRide.dropoffLat, lng: activeRide.dropoffLng };
    let cancelled = false;

    const doFetch = () => {
      const s = useDriverStatusStore.getState();
      const pos = s.currentLat != null && s.currentLng != null
        ? { lat: s.currentLat, lng: s.currentLng } : null;
      if (!pos) return;
      void fetchRoute(pos, dest).then((r) => { if (!cancelled && r) setRoute(r); });
    };

    doFetch();
    const id = setInterval(doFetch, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [phase, activeRide?.dropoffLat, activeRide?.dropoffLng]);

  // ── Chase vehicle position (Tier 3/4 tandem) ───────────────────────────

  const tandemJobId = useDispatchStore((s) => s.tandemJobId);
  const isTandemTier = tier === 'tier_3_vehicle_paired' || tier === 'tier_4_full_concierge';

  useEffect(() => {
    if (!isTandemTier || !tandemJobId) return;
    let cancelled = false;

    const poll = async () => {
      try {
        // Get the tandem job to find ride-along driver id
        const { data: job } = await supabase
          .from('tandem_jobs')
          .select('ride_along_driver_id')
          .eq('id', tandemJobId)
          .maybeSingle();

        const rideAlongDriverId = (job as { ride_along_driver_id?: string | null } | null)
          ?.ride_along_driver_id;
        if (!rideAlongDriverId || cancelled) return;

        // Look up the ride-along driver's user_id, then get their driver record position
        const { data: rad } = await supabase
          .from('ride_along_drivers')
          .select('user_id')
          .eq('id', rideAlongDriverId)
          .maybeSingle();

        const userId = (rad as { user_id?: string } | null)?.user_id;
        if (!userId || cancelled) return;

        const { data: driverRow } = await supabase
          .from('drivers')
          .select('current_lat, current_lng')
          .eq('user_id', userId)
          .maybeSingle();

        const dr = driverRow as { current_lat?: number | null; current_lng?: number | null } | null;
        if (dr?.current_lat != null && dr?.current_lng != null && !cancelled) {
          setPartnerPos({ lat: dr.current_lat, lng: dr.current_lng });
        }
      } catch { /* swallow */ }
    };

    void poll();
    const id = setInterval(poll, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isTandemTier, tandemJobId]);

  // ── Camera / file input ──────────────────────────────────────────────────

  const capturePhoto = useCallback(async (set: 'pickup' | 'dropoff', angleId: AngleId) => {
    if (Capacitor.isNativePlatform()) {
      try {
        const photo = await Camera.getPhoto({
          quality: 80,
          resultType: CameraResultType.DataUrl,
          source: CameraSource.Camera,
          promptLabelHeader: PHOTO_ANGLES.find((a) => a.id === angleId)?.label ?? 'Take Photo',
        });
        if (photo.dataUrl) {
          if (set === 'pickup') setPickupPhotos((p) => ({ ...p, [angleId]: photo.dataUrl! }));
          else setDropoffPhotos((p) => ({ ...p, [angleId]: photo.dataUrl! }));
        }
      } catch { /* user cancelled */ }
    } else {
      // Web fallback: trigger hidden file input
      pendingAngleRef.current = { set, angleId };
      fileInputRef.current?.click();
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const pending = pendingAngleRef.current;
    if (!file || !pending) return;
    const url = URL.createObjectURL(file);
    if (pending.set === 'pickup') setPickupPhotos((p) => ({ ...p, [pending.angleId]: url }));
    else setDropoffPhotos((p) => ({ ...p, [pending.angleId]: url }));
    pendingAngleRef.current = null;
    e.target.value = '';
  };

  // ── Upload photos to Supabase Storage ────────────────────────────────────

  const uploadPhotos = useCallback(async (
    photos: PhotoSet,
    phase: 'pickup' | 'dropoff',
  ): Promise<void> => {
    if (!rideId) return;
    const entries = Object.entries(photos) as [AngleId, string][];
    for (const [angleId, dataUrl] of entries) {
      setUploadProgress(`Uploading ${phase} photos… (${angleId})`);
      // Convert dataUrl / objectUrl to blob
      let blob: Blob;
      if (dataUrl.startsWith('data:')) {
        const res = await fetch(dataUrl);
        blob = await res.blob();
      } else {
        const res = await fetch(dataUrl);
        blob = await res.blob();
      }
      const path = `${rideId}/${phase}/${angleId}.jpg`;
      await supabase.storage.from('relocation-photos').upload(path, blob, {
        contentType: 'image/jpeg',
        upsert: true,
      });
    }
    setUploadProgress('');
  }, [rideId]);

  // ── Phase actions ────────────────────────────────────────────────────────

  const handleConfirmPickup = useCallback(async () => {
    setPhase('uploading');
    setUploadProgress('Uploading pickup photos…');
    await uploadPhotos(pickupPhotos, 'pickup');
    await startNavigating();
    setPhase('navigating');
  }, [pickupPhotos, uploadPhotos, startNavigating]);

  const handleArrivedAtDropoff = useCallback(async () => {
    await markArrived();
    await startRide();
    setPhase('dropoff_photos');
  }, [markArrived, startRide]);

  const handleConfirmDropoff = useCallback(async () => {
    setPhase('uploading');
    setUploadProgress('Uploading dropoff photos…');
    await uploadPhotos(dropoffPhotos, 'dropoff');
    setPhase('confirming');
  }, [dropoffPhotos, uploadPhotos]);

  const handleCompleteRide = useCallback(async () => {
    if (!activeRide) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      const result = await completeRide(activeRide.estimatedDistance);
      if (result.success) {
        navigate(`/ride/${result.rideId}/complete`);
      } else {
        setCompleteError("Couldn't complete the ride. Try again.");
      }
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setCompleting(false);
    }
  }, [activeRide, completeRide, navigate]);

  // ── Guard ────────────────────────────────────────────────────────────────

  if (!activeRide) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏁</div>
          <div className="heading-editorial heading-editorial-md" style={{ marginBottom: 12 }}>No Active Ride</div>
          <Button onClick={() => navigate('/home')} variant="secondary">Go Home</Button>
        </div>
      </div>
    );
  }

  // ── Upload progress overlay ──────────────────────────────────────────────

  if (phase === 'uploading') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 24,
        background: colors.bgPrimary,
      }}>
        <Spinner size={36} color={colors.gold} />
        <div style={{ marginTop: 20, fontSize: 15, color: colors.textMuted, textAlign: 'center' }}>
          {uploadProgress || 'Uploading photos…'}
        </div>
      </div>
    );
  }

  // ── Destination for map ──────────────────────────────────────────────────

  const mapDest: LatLng & { label: string } =
    phase === 'navigating'
      ? { lat: activeRide.dropoffLat, lng: activeRide.dropoffLng, label: activeRide.dropoffAddress }
      : { lat: activeRide.pickupLat, lng: activeRide.pickupLng, label: activeRide.pickupAddress };

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
      {/* Hidden file input for web camera fallback */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {/* Map */}
      <div style={{ height: '30vh', position: 'relative' }}>
        <MapView
          center={driverPosition ?? { lat: mapDest.lat, lng: mapDest.lng }}
          driverPosition={driverPosition}
          partnerPosition={isTandemTier ? partnerPos : null}
          destinations={[mapDest]}
          routePolyline={route?.polyline}
          zoom={14}
          style={{ height: '100%' }}
        />
        <button
          onClick={() => navigate('/home')}
          aria-label="Go back to home"
          style={{
            position: 'absolute', top: 'max(14px, env(safe-area-inset-top))', left: 14,
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)', border: 'none',
            color: '#fff', fontSize: 20, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >←</button>

        {/* ETA strip when navigating */}
        {phase === 'navigating' && route && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: 'rgba(27,42,74,0.85)',
            display: 'flex', justifyContent: 'center', gap: 32,
            padding: '8px 0',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{route.etaMinutes} <span style={{ fontSize: 12 }}>min</span></div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>ETA</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>{(route.distanceMeters / 1609.34).toFixed(1)} <span style={{ fontSize: 12 }}>mi</span></div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Away</div>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{
        flex: 1, padding: '16px 20px 28px',
        borderRadius: `${borderRadius.xl}px ${borderRadius.xl}px 0 0`,
        marginTop: -16, background: colors.bgPrimary, overflowY: 'auto',
      }}>

        {/* Scenario badge */}
        <div style={{ marginBottom: 16 }}>
          <span className="eyebrow">{getScenarioLabel(activeRide.scenario)}</span>
          {isTandemTier && (
            <span style={{
              marginLeft: 8, fontSize: 10, fontWeight: 700,
              background: colors.gold, color: colors.navy,
              padding: '2px 8px', borderRadius: borderRadius.full,
            }}>TANDEM</span>
          )}
        </div>

        {/* ── PHASE: PICKUP PHOTOS ─────────────────────────────── */}
        {phase === 'pickup_photos' && (
          <>
            <SectionHeader
              icon="📸"
              title="Pre-Pickup Condition"
              subtitle="Photograph all 6 angles before taking possession of the vehicle."
            />

            <PhotoGrid
              photos={pickupPhotos}
              onCapture={(id) => void capturePhoto('pickup', id)}
            />

            {/* Pickup contact */}
            {pickupContact?.phone && (
              <ContactCard
                label="Pickup Contact"
                name={pickupContact.name}
                phone={pickupContact.phone}
              />
            )}

            <div style={{ marginBottom: 8 }}>
              <InfoRow icon="📍" label="Pickup" value={shortenAddress(activeRide.pickupAddress)} />
              <InfoRow icon="🏁" label="Dropoff" value={shortenAddress(activeRide.dropoffAddress)} />
              <InfoRow icon="💰" label="Est. Fare" value={formatCurrency(activeRide.estimatedFare)} valueColor={colors.navy} />
            </div>

            <Button
              onClick={() => void handleConfirmPickup()}
              fullWidth
              size="lg"
              disabled={PHOTO_ANGLES.length > Object.keys(pickupPhotos).length}
              style={{ marginTop: 8 }}
            >
              {PHOTO_ANGLES.length > Object.keys(pickupPhotos).length
                ? `${Object.keys(pickupPhotos).length}/${PHOTO_ANGLES.length} photos taken`
                : 'Confirm Pickup & Navigate'}
            </Button>
          </>
        )}

        {/* ── PHASE: NAVIGATING ───────────────────────────────── */}
        {phase === 'navigating' && (
          <>
            <SectionHeader
              icon="🧭"
              title="Navigate to Dropoff"
              subtitle={shortenAddress(activeRide.dropoffAddress)}
            />

            {activeRide.memberVehicleDescription && (
              <Card style={{ marginBottom: 12 }} padding={14}>
                <InfoRow icon="🚙" label="Vehicle" value={activeRide.memberVehicleDescription} />
              </Card>
            )}

            {/* Dropoff contact */}
            {dropoffContact?.phone && (
              <ContactCard
                label="Dropoff Contact"
                name={dropoffContact.name}
                phone={dropoffContact.phone}
              />
            )}

            <Button
              onClick={() => openNavigation(preferredNav, {
                lat: activeRide.dropoffLat, lng: activeRide.dropoffLng,
                label: activeRide.dropoffAddress,
              })}
              variant="secondary"
              fullWidth
              size="md"
              style={{ marginBottom: 12 }}
            >
              Open in {getNavAppName(preferredNav)} →
            </Button>

            <Button
              onClick={() => void handleArrivedAtDropoff()}
              fullWidth
              size="lg"
              variant="success"
            >
              I've Arrived at Dropoff
            </Button>
          </>
        )}

        {/* ── PHASE: DROPOFF PHOTOS ───────────────────────────── */}
        {phase === 'dropoff_photos' && (
          <>
            <SectionHeader
              icon="📸"
              title="Post-Dropoff Condition"
              subtitle="Photograph all 6 angles to document the vehicle at handoff."
            />

            <PhotoGrid
              photos={dropoffPhotos}
              onCapture={(id) => void capturePhoto('dropoff', id)}
            />

            {dropoffContact?.phone && (
              <ContactCard
                label="Dropoff Contact"
                name={dropoffContact.name}
                phone={dropoffContact.phone}
              />
            )}

            <Button
              onClick={() => void handleConfirmDropoff()}
              fullWidth
              size="lg"
              disabled={PHOTO_ANGLES.length > Object.keys(dropoffPhotos).length}
              style={{ marginTop: 8 }}
            >
              {PHOTO_ANGLES.length > Object.keys(dropoffPhotos).length
                ? `${Object.keys(dropoffPhotos).length}/${PHOTO_ANGLES.length} photos taken`
                : 'Photos Done — Confirm Delivery'}
            </Button>
          </>
        )}

        {/* ── PHASE: CONFIRMING ───────────────────────────────── */}
        {phase === 'confirming' && (
          <>
            <SectionHeader
              icon="✅"
              title="Confirm Delivery"
              subtitle="Review the before/after photos and confirm the vehicle was delivered in acceptable condition."
            />

            <Card padding={14} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                Pickup ({Object.keys(pickupPhotos).length} photos)
              </div>
              <PhotoThumbnailRow photos={pickupPhotos} />
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, margin: '12px 0 10px' }}>
                Dropoff ({Object.keys(dropoffPhotos).length} photos)
              </div>
              <PhotoThumbnailRow photos={dropoffPhotos} />
            </Card>

            {completeError && (
              <div style={{
                marginBottom: 12, padding: '10px 14px',
                background: '#FEF2F2', border: '1px solid #FCA5A5',
                borderRadius: 8, color: '#991B1B', fontSize: 13, fontWeight: 600,
              }}>
                {completeError}
              </div>
            )}

            <Button
              onClick={() => void handleCompleteRide()}
              loading={completing}
              fullWidth
              size="lg"
              variant="success"
              style={{ boxShadow: `0 6px 28px ${withAlpha(colors.success, '55')}` }}
            >
              Complete Relocation
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 24, marginBottom: 6 }}>{icon}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: colors.navy, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 13, color: colors.textMuted }}>{subtitle}</div>
    </div>
  );
}

function ContactCard({ label, name, phone }: { label: string; name: string; phone: string }) {
  return (
    <Card style={{ marginBottom: 12 }} padding={14}>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: colors.navy }}>{name}</div>
          {phone && <div style={{ fontSize: 13, color: colors.textMuted }}>{phone}</div>}
        </div>
        {phone && (
          <a
            href={`tel:${phone}`}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 48, height: 48, borderRadius: '50%',
              background: colors.success, color: '#fff',
              fontSize: 20, textDecoration: 'none',
            }}
            aria-label={`Call ${name}`}
          >
            📞
          </a>
        )}
      </div>
    </Card>
  );
}

function PhotoGrid({ photos, onCapture }: { photos: PhotoSet; onCapture: (id: AngleId) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
      {PHOTO_ANGLES.map(({ id, label, icon }) => {
        const captured = !!photos[id];
        return (
          <button
            key={id}
            onClick={() => onCapture(id)}
            style={{
              padding: 0, border: `2px solid ${captured ? colors.success : colors.border}`,
              borderRadius: borderRadius.md, background: captured ? 'rgba(52,211,153,0.06)' : colors.bgSecondary,
              cursor: 'pointer', fontFamily: 'inherit', overflow: 'hidden',
              minHeight: 90, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              position: 'relative',
            }}
          >
            {captured ? (
              <>
                <img
                  src={photos[id]}
                  alt={label}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }}
                />
                <div style={{
                  position: 'absolute', bottom: 4, right: 4,
                  background: colors.success, borderRadius: '50%',
                  width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: '#fff',
                }}>✓</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
                <div style={{ fontSize: 10, color: colors.textMuted, textAlign: 'center', padding: '0 4px', lineHeight: 1.3 }}>{label}</div>
                <div style={{ fontSize: 16, color: colors.textMuted, marginTop: 4 }}>+</div>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PhotoThumbnailRow({ photos }: { photos: PhotoSet }) {
  const entries = Object.entries(photos) as [AngleId, string][];
  if (entries.length === 0) return <div style={{ fontSize: 12, color: colors.textMuted }}>No photos</div>;
  return (
    <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
      {entries.map(([id, url]) => (
        <img
          key={id}
          src={url}
          alt={id}
          style={{ width: 64, height: 64, borderRadius: borderRadius.sm, objectFit: 'cover', flexShrink: 0 }}
        />
      ))}
    </div>
  );
}
