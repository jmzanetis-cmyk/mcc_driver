// ============================================================
// MCC Driver — Vehicle Relocation / Concierge Ride Screen
// ============================================================
// Handles vehicle_delivery_solo, vehicle_pickup_solo,
// paired_vehicle_*, concierge_* scenarios.
//
// Phase is derived from dispatch stage + vehicle_inspections DB records
// so it survives navigation to/from VehicleInspectionScreen:
//
//   pickup_inspection  → navigate to /ride/:id/inspection/pickup
//   pickup_ready       → startNavigating()
//   navigating         → en route, "I've Arrived" CTA
//   dropoff_inspection → navigate to /ride/:id/inspection/dropoff
//   confirming         → completeRide()
//
// Photo capture is fully delegated to VehicleInspectionScreen.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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

// ── Derived phase ────────────────────────────────────────────────────────────

type RelocationPhase =
  | 'loading'             // inspection records not yet fetched
  | 'pickup_inspection'   // need pre-pickup photos
  | 'pickup_ready'        // photos done, ready to start navigating
  | 'navigating'          // en route to dropoff
  | 'dropoff_inspection'  // need post-delivery photos
  | 'confirming';         // photos done, ready to complete ride

// ── Component ────────────────────────────────────────────────────────────────

export function RelocationScreen() {
  const navigate = useNavigate();
  const { activeRide, startNavigating, markArrived, startRide, completeRide } = useActiveRide();

  const rideId = useDispatchStore((s) => s.rideId);
  const tier = useDispatchStore((s) => s.tier);
  const dispatchStage = useDispatchStore((s) => s.stage);

  const currentLat = useDriverStatusStore((s) => s.currentLat);
  const currentLng = useDriverStatusStore((s) => s.currentLng);
  const driverPosition: LatLng | null =
    currentLat != null && currentLng != null ? { lat: currentLat, lng: currentLng } : null;

  const [pickupInspectionId, setPickupInspectionId] = useState<string | null>(null);
  const [dropoffInspectionId, setDropoffInspectionId] = useState<string | null>(null);
  const [inspectionsLoaded, setInspectionsLoaded] = useState(false);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [partnerPos, setPartnerPos] = useState<LatLng | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [preferredNav] = useState<NavApp>(() => {
    try { return (localStorage.getItem('mcc_preferred_nav') as NavApp) ?? getDefaultNavApp(); }
    catch { return getDefaultNavApp(); }
  });

  // Contact info fetched from ride row
  const [pickupContact, setPickupContact] = useState<{ name: string; phone: string } | null>(null);
  const [dropoffContact, setDropoffContact] = useState<{ name: string; phone: string } | null>(null);

  // ── Query inspection records on every mount ─────────────────────────────
  // Runs after returning from VehicleInspectionScreen because React Router
  // remounts this component on navigation back.

  useEffect(() => {
    if (!rideId) return;
    setInspectionsLoaded(false);
    void (async () => {
      try {
        const { data } = await supabase
          .from('vehicle_inspections')
          .select('id, phase')
          .eq('ride_id', rideId)
          .eq('status', 'submitted');
        for (const row of data ?? []) {
          const r = row as { id: string; phase: string };
          if (r.phase === 'pickup')  setPickupInspectionId(r.id);
          if (r.phase === 'dropoff') setDropoffInspectionId(r.id);
        }
      } finally {
        setInspectionsLoaded(true);
      }
    })();
  }, [rideId]);

  // ── Derive current phase ─────────────────────────────────────────────────

  const currentPhase: RelocationPhase = useMemo(() => {
    if (!inspectionsLoaded) return 'loading';
    if (!pickupInspectionId) return 'pickup_inspection';
    if (dispatchStage === 'accepted') return 'pickup_ready';
    if (dispatchStage === 'navigating' || dispatchStage === 'arrived') return 'navigating';
    if (dispatchStage === 'in_progress' && !dropoffInspectionId) return 'dropoff_inspection';
    return 'confirming';
  }, [inspectionsLoaded, pickupInspectionId, dropoffInspectionId, dispatchStage]);

  // ── Ride contact info ───────────────────────────────────────────────────

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
        pickup_contact_name?: string | null; pickup_contact_phone?: string | null;
        dropoff_contact_name?: string | null; dropoff_contact_phone?: string | null;
        member_phone?: string | null;
      };
      const memberPhone = d.member_phone ?? null;
      setPickupContact({ name: d.pickup_contact_name ?? 'Pickup Contact', phone: d.pickup_contact_phone ?? memberPhone ?? '' });
      setDropoffContact({ name: d.dropoff_contact_name ?? 'Dropoff Contact', phone: d.dropoff_contact_phone ?? memberPhone ?? '' });
    })();
  }, [rideId]);

  // ── Route fetch (30 s interval while navigating) ────────────────────────

  useEffect(() => {
    if ((dispatchStage !== 'navigating' && dispatchStage !== 'arrived') || !activeRide) return;
    const dest = { lat: activeRide.dropoffLat, lng: activeRide.dropoffLng };
    let cancelled = false;
    const doFetch = () => {
      const s = useDriverStatusStore.getState();
      const pos = s.currentLat != null && s.currentLng != null ? { lat: s.currentLat, lng: s.currentLng } : null;
      if (!pos) return;
      void fetchRoute(pos, dest).then((r) => { if (!cancelled && r) setRoute(r); });
    };
    doFetch();
    const id = setInterval(doFetch, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [dispatchStage, activeRide?.dropoffLat, activeRide?.dropoffLng]);

  // ── Chase vehicle position (Tier 3/4 tandem) ────────────────────────────

  const tandemJobId = useDispatchStore((s) => s.tandemJobId);
  const isTandemTier = tier === 'tier_3_vehicle_paired' || tier === 'tier_4_full_concierge';

  useEffect(() => {
    if (!isTandemTier || !tandemJobId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { data: job } = await supabase.from('tandem_jobs').select('ride_along_driver_id').eq('id', tandemJobId).maybeSingle();
        const rideAlongDriverId = (job as { ride_along_driver_id?: string | null } | null)?.ride_along_driver_id;
        if (!rideAlongDriverId || cancelled) return;
        const { data: rad } = await supabase.from('ride_along_drivers').select('user_id').eq('id', rideAlongDriverId).maybeSingle();
        const userId = (rad as { user_id?: string } | null)?.user_id;
        if (!userId || cancelled) return;
        const { data: driverRow } = await supabase.from('drivers').select('current_lat, current_lng').eq('user_id', userId).maybeSingle();
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

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleStartNavigating = useCallback(async () => {
    await startNavigating();
    if (activeRide) {
      openNavigation(preferredNav, { lat: activeRide.dropoffLat, lng: activeRide.dropoffLng, label: activeRide.dropoffAddress });
    }
  }, [startNavigating, activeRide, preferredNav]);

  const handleArrivedAtDropoff = useCallback(async () => {
    await markArrived();
    await startRide();
    // Stage becomes 'in_progress' → derived phase becomes 'dropoff_inspection'
  }, [markArrived, startRide]);

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

  // ── Loading phase ────────────────────────────────────────────────────────

  if (currentPhase === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.bgPrimary }}>
        <Spinner size={32} color={colors.gold} />
      </div>
    );
  }

  // ── Map destination ──────────────────────────────────────────────────────

  const isNavigating = currentPhase === 'navigating';
  const mapDest: LatLng & { label: string } = isNavigating
    ? { lat: activeRide.dropoffLat, lng: activeRide.dropoffLng, label: activeRide.dropoffAddress }
    : { lat: activeRide.pickupLat, lng: activeRide.pickupLng, label: activeRide.pickupAddress };

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>

      {/* Map */}
      <div style={{ height: '30vh', position: 'relative' }}>
        <MapView
          center={driverPosition ?? { lat: mapDest.lat, lng: mapDest.lng }}
          driverPosition={driverPosition}
          partnerPosition={isTandemTier ? partnerPos : null}
          destinations={[mapDest]}
          routePolyline={isNavigating ? route?.polyline : undefined}
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

        {/* ETA strip while navigating */}
        {isNavigating && route && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: 'rgba(27,42,74,0.85)',
            display: 'flex', justifyContent: 'center', gap: 32, padding: '8px 0',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>
                {route.etaMinutes} <span style={{ fontSize: 12 }}>min</span>
              </div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>ETA</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>
                {(route.distanceMeters / 1609.34).toFixed(1)} <span style={{ fontSize: 12 }}>mi</span>
              </div>
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

        {/* ── PHASE: PICKUP INSPECTION ──────────────────────────── */}
        {currentPhase === 'pickup_inspection' && (
          <>
            <SectionHeader
              icon="📋"
              title="Pre-Pickup Inspection Required"
              subtitle="Photograph all 6 angles before taking possession of the vehicle."
            />

            {pickupContact?.phone && <ContactCard label="Pickup Contact" name={pickupContact.name} phone={pickupContact.phone} />}

            <div style={{ marginBottom: 16 }}>
              <InfoRow icon="📍" label="Pickup" value={shortenAddress(activeRide.pickupAddress)} />
              <InfoRow icon="🏁" label="Dropoff" value={shortenAddress(activeRide.dropoffAddress)} />
              <InfoRow icon="💰" label="Est. Fare" value={formatCurrency(activeRide.estimatedFare)} valueColor={colors.navy} />
            </div>

            <Button
              onClick={() => navigate(`/ride/${rideId}/inspection/pickup`)}
              fullWidth size="lg"
            >
              📸 Start Pre-Pickup Inspection
            </Button>
          </>
        )}

        {/* ── PHASE: PICKUP READY ───────────────────────────────── */}
        {currentPhase === 'pickup_ready' && (
          <>
            <SectionHeader
              icon="✅"
              title="Inspection Complete"
              subtitle="Pre-pickup photos submitted. Navigate to the dropoff location."
            />

            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 16px', borderRadius: borderRadius.md,
              background: withAlpha(colors.success, '10'),
              border: `1px solid ${withAlpha(colors.success, '30')}`,
              marginBottom: 16,
            }}>
              <div style={{ fontSize: 22 }}>🟢</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: colors.success }}>Pre-pickup inspection submitted</div>
                <div style={{ fontSize: 12, color: colors.textMuted }}>6 photos on record</div>
              </div>
            </div>

            {pickupContact?.phone && <ContactCard label="Pickup Contact" name={pickupContact.name} phone={pickupContact.phone} />}

            <div style={{ marginBottom: 16 }}>
              <InfoRow icon="🏁" label="Dropoff" value={shortenAddress(activeRide.dropoffAddress)} />
              <InfoRow icon="💰" label="Est. Fare" value={formatCurrency(activeRide.estimatedFare)} valueColor={colors.navy} />
              {activeRide.estimatedDistance && (
                <InfoRow icon="📏" label="Distance" value={formatDistance(activeRide.estimatedDistance)} />
              )}
            </div>

            <Button
              onClick={() => void handleStartNavigating()}
              fullWidth size="lg" variant="primary"
            >
              Navigate to Dropoff → ({getNavAppName(preferredNav)})
            </Button>
          </>
        )}

        {/* ── PHASE: NAVIGATING ────────────────────────────────── */}
        {currentPhase === 'navigating' && (
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

            {dropoffContact?.phone && <ContactCard label="Dropoff Contact" name={dropoffContact.name} phone={dropoffContact.phone} />}

            <Button
              onClick={() => openNavigation(preferredNav, { lat: activeRide.dropoffLat, lng: activeRide.dropoffLng, label: activeRide.dropoffAddress })}
              variant="secondary" fullWidth size="md" style={{ marginBottom: 12 }}
            >
              Open in {getNavAppName(preferredNav)} →
            </Button>

            <Button
              onClick={() => void handleArrivedAtDropoff()}
              fullWidth size="lg" variant="success"
            >
              I've Arrived at Dropoff
            </Button>
          </>
        )}

        {/* ── PHASE: DROPOFF INSPECTION ────────────────────────── */}
        {currentPhase === 'dropoff_inspection' && (
          <>
            <SectionHeader
              icon="📋"
              title="Post-Delivery Inspection Required"
              subtitle="Photograph all 6 angles to document the vehicle at handoff."
            />

            {dropoffContact?.phone && <ContactCard label="Dropoff Contact" name={dropoffContact.name} phone={dropoffContact.phone} />}

            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 16px', borderRadius: borderRadius.md,
              background: withAlpha(colors.success, '10'),
              border: `1px solid ${withAlpha(colors.success, '30')}`,
              marginBottom: 16,
            }}>
              <div style={{ fontSize: 18 }}>🟢</div>
              <div style={{ fontSize: 13, color: colors.textSecondary }}>
                Pre-pickup photos on record — now document the vehicle at delivery.
              </div>
            </div>

            <Button
              onClick={() => navigate(`/ride/${rideId}/inspection/dropoff`)}
              fullWidth size="lg"
            >
              📸 Start Post-Delivery Inspection
            </Button>
          </>
        )}

        {/* ── PHASE: CONFIRMING ────────────────────────────────── */}
        {currentPhase === 'confirming' && (
          <>
            <SectionHeader
              icon="✅"
              title="Inspections Complete"
              subtitle="Both pre-pickup and post-delivery photos are on record. Complete the relocation."
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {[
                { label: 'Pre-pickup inspection', id: pickupInspectionId },
                { label: 'Post-delivery inspection', id: dropoffInspectionId },
              ].map(({ label, id }) => (
                <div key={label} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', borderRadius: borderRadius.md,
                  background: withAlpha(colors.success, '08'),
                  border: `1px solid ${withAlpha(colors.success, '25')}`,
                }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: colors.success, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, color: '#fff', flexShrink: 0,
                  }}>✓</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy }}>{label}</div>
                    <div style={{ fontSize: 11, color: colors.textMuted }}>ID: {id?.slice(0, 8)}…</div>
                  </div>
                </div>
              ))}
            </div>

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
              fullWidth size="lg" variant="success"
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
          >📞</a>
        )}
      </div>
    </Card>
  );
}
