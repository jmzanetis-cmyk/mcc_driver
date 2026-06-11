// ============================================================
// MCC Driver — Navigate Screen
// ============================================================
// Shows pickup/dropoff info and launches preferred nav app.
// Also handles external ride cancellation — when a member or
// admin cancels after the driver has accepted, a full-screen
// overlay is shown and the driver is returned to home.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveRide, type ActiveRideStage } from '@/hooks/useActiveRide';
import { useAuth } from '@/hooks/useAuth';
import { useDispatchStore } from '@/store/dispatchStore';
import { openNavigation, getNavAppName, getDefaultNavApp, type NavApp } from '@/services/navigation/navService';
import { fetchRoute, type RouteResult } from '@/services/navigation/routeService';
import { Button, Card, InfoRow, PageHeader, Spinner, MapView } from '@/components';
import { SpeedChip } from '@/components/SpeedChip';
import { useDriverStatusStore } from '@/store/driverStatusStore';
import { colors, borderRadius, withAlpha } from '@/theme';
import { useTrackingPublisher } from '@/hooks/useTrackingPublisher';
import {
  formatCurrency, formatDistance, getScenarioLabel, getTierLabel,
  getRoleDescription, shortenAddress, formatElapsed,
} from '@/utils/formatters';
import { createTandemJob, updateTandemJobMode, setKnownPartner, reportNoShow, reportUndrivable, type PartnerLookupResult } from '@/services/api/edgeFunctions';
import { ProviderTandemMatchPanel } from '@/components/ProviderTandemMatchPanel';
import { TripChat } from '@/components/TripChat';

const KNOWN_PARTNER_KEY = 'mcc_known_partner';
type TandemMode = 'A' | 'B' | 'C';

export function NavigateScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const {
    activeRide, startNavigating, markArrived, startRide,
    completeRide, cancelRide, advanceWaypoint,
  } = useActiveRide();

  // Used by the cancelled overlay to clear dispatch and show cancellation reason
  const dispatch = useDispatchStore();

  const [preferredNav, setPreferredNav] = useState<NavApp>(() => {
    try {
      const saved = localStorage.getItem('mcc_preferred_nav') as NavApp | null;
      return saved ?? getDefaultNavApp();
    } catch {
      return getDefaultNavApp();
    }
  });
  const [elapsed, setElapsed] = useState('0:00');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [queuedCompletion, setQueuedCompletion] = useState(false);

  const { isPublishing, currentSpeedMph } = useTrackingPublisher();
  const [speedBannerDismissed, setSpeedBannerDismissed] = useState(() => {
    try { return !!localStorage.getItem('mcc_speed_onboard_dismissed'); } catch { return false; }
  });

  // Wait timer — starts when stage transitions to 'arrived'
  const [arrivedAtTs, setArrivedAtTs] = useState<number | null>(null);
  const [waitElapsedSec, setWaitElapsedSec] = useState(0);
  const [noShowLoading, setNoShowLoading] = useState(false);
  const [undrivableLoading, setUndrivableLoading] = useState(false);

  // Tandem mode selector state
  const [selectedMode, setSelectedMode] = useState<TandemMode | null>(null);
  const [showModeCSafety, setShowModeCSafety] = useState(false);
  const [tandemConfirming, setTandemConfirming] = useState(false);
  const [tandemError, setTandemError] = useState<string | null>(null);
  const [savedPartner, setSavedPartner] = useState<PartnerLookupResult | null>(null);

  const tandemRequired = useDispatchStore((s) => s.tandemRequired);
  const tandemFee = useDispatchStore((s) => s.tandemFee);
  const tandemModeConfirmed = useDispatchStore((s) => s.tandemModeConfirmed);
  const persistedTandemMode = useDispatchStore((s) => s.tandemMode);
  const existingTandemJobId = useDispatchStore((s) => s.tandemJobId);
  const setTandemJob = useDispatchStore((s) => s.setTandemJob);
  const rideId = useDispatchStore((s) => s.rideId);

  const currentLat = useDriverStatusStore((s) => s.currentLat);
  const currentLng = useDriverStatusStore((s) => s.currentLng);
  const driverPosition = currentLat != null && currentLng != null
    ? { lat: currentLat, lng: currentLng }
    : null;

  // Computed before early returns so they're available in effects
  const isNavigatingToPickup = dispatch.stage === 'accepted' || dispatch.stage === 'navigating';

  // Waypoint-aware current destination: during in_progress, navigate to current waypoint if any
  const waypoints = dispatch.waypoints ?? null;
  const currentWpIdx = dispatch.currentWaypointIndex ?? 0;
  const currentWaypoint = waypoints && waypoints[currentWpIdx] && dispatch.stage === 'in_progress'
    ? waypoints[currentWpIdx]!
    : null;
  const isLastWaypoint = !waypoints || currentWpIdx >= waypoints.length - 1;

  const routeDest: { lat: number; lng: number } | null = currentWaypoint
    ? { lat: currentWaypoint.lat, lng: currentWaypoint.lng }
    : isNavigatingToPickup
    ? (dispatch.pickupLat != null && dispatch.pickupLng != null
        ? { lat: dispatch.pickupLat, lng: dispatch.pickupLng }
        : null)
    : (dispatch.dropoffLat != null && dispatch.dropoffLng != null
        ? { lat: dispatch.dropoffLat, lng: dispatch.dropoffLng }
        : null);

  // Load saved tandem partner from localStorage (nav pref is lazy-initialized above)
  useEffect(() => {
    const partnerJson = localStorage.getItem(KNOWN_PARTNER_KEY);
    if (partnerJson) {
      try { setSavedPartner(JSON.parse(partnerJson) as PartnerLookupResult); } catch { /* ignore */ }
    }
  }, []);

  // Update elapsed time when ride is in progress
  useEffect(() => {
    if (!activeRide?.startedAt) return;
    const interval = setInterval(() => {
      setElapsed(formatElapsed(activeRide.startedAt ?? ''));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeRide?.startedAt]);

  // Auto-navigate home when ride is externally cancelled (countdown)
  useEffect(() => {
    if (activeRide?.stage !== 'cancelled') return;

    setCountdown(5);
    const tick = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(tick);
          dispatch.setServerCancelled(false);
          dispatch.clearDispatch();
          navigate('/home');
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(tick);
  }, [activeRide?.stage]);

  // Fetch route + ETA when destination is known. Refreshes every 30s so ETA
  // stays accurate as the driver moves. Uses the latest driver position at
  // interval fire time via the store directly (avoids stale closure).
  useEffect(() => {
    if (!routeDest) return;
    let cancelled = false;

    const doFetch = () => {
      const s = useDriverStatusStore.getState();
      const pos = s.currentLat != null && s.currentLng != null
        ? { lat: s.currentLat, lng: s.currentLng }
        : null;
      if (!pos) return;
      void fetchRoute(pos, routeDest).then((r) => {
        if (!cancelled && r) setRoute(r);
      });
    };

    doFetch();
    const id = setInterval(doFetch, 30_000);
    return () => { cancelled = true; clearInterval(id); };
    // Re-run only when destination changes, not on every position tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeDest?.lat, routeDest?.lng]);

  // Stamp arrived time when the stage transitions to 'arrived'
  useEffect(() => {
    if (activeRide?.stage === 'arrived') {
      if (!arrivedAtTs) setArrivedAtTs(Date.now());
    } else {
      setArrivedAtTs(null);
      setWaitElapsedSec(0);
    }
  }, [activeRide?.stage]);

  // Live wait counter
  useEffect(() => {
    if (!arrivedAtTs) return;
    const iv = setInterval(() => {
      setWaitElapsedSec(Math.floor((Date.now() - arrivedAtTs) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [arrivedAtTs]);

  // ── Cancelled overlay ──────────────────────────────────────────────────────
  if (activeRide?.stage === 'cancelled') {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: colors.bgOverlay,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}>
        <Card style={{ maxWidth: 360, width: '100%', textAlign: 'center' }} padding={32}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>🚫</div>
          <div className="heading-editorial heading-editorial-lg" style={{ marginBottom: 8 }}>
            Ride Cancelled
          </div>
          <div style={{ fontSize: 14, color: colors.textMuted, marginBottom: 24 }}>
            {activeRide.cancellationReason ?? 'This ride has been cancelled.'}
          </div>
          <div style={{
            fontSize: 13, color: colors.textMuted,
            marginBottom: 20,
            padding: '8px 16px',
            background: colors.bgSecondary,
            borderRadius: borderRadius.md,
          }}>
            Returning to home in <strong style={{ color: colors.navy }}>{countdown}s</strong>
          </div>
          <Button
            onClick={() => { dispatch.setServerCancelled(false); dispatch.clearDispatch(); navigate('/home'); }}
            variant="primary"
            fullWidth
          >
            Go to Home Now
          </Button>
        </Card>
      </div>
    );
  }

  // ── Tandem Mode Selector ─────────────────────────────────────────────────────
  const handleConfirmTandemMode = async () => {
    if (!selectedMode || !rideId) return;
    if (selectedMode === 'A' && !savedPartner) {
      setTandemError('Please add a Known Partner in Settings first, then return here');
      return;
    }
    if (selectedMode === 'C' && !showModeCSafety) {
      setShowModeCSafety(true);
      return;
    }
    setTandemConfirming(true);
    setTandemError(null);

    let tandemJobId: string;

    if (existingTandemJobId) {
      // Tandem job already exists — patch the mode instead of creating a duplicate
      const updateResult = await updateTandemJobMode(existingTandemJobId, selectedMode);
      if (!updateResult.success || !updateResult.data) {
        setTandemConfirming(false);
        setTandemError(updateResult.error ?? 'Failed to update tandem mode');
        return;
      }
      tandemJobId = updateResult.data.id;
    } else {
      // First confirmation — create the tandem job record
      const createResult = await createTandemJob(rideId, selectedMode);
      if (!createResult.success || !createResult.data) {
        setTandemConfirming(false);
        setTandemError(createResult.error ?? 'Failed to create tandem job');
        return;
      }
      tandemJobId = createResult.data.id;
    }

    // Mode A: link the saved known partner to this tandem job on the server
    if (selectedMode === 'A' && savedPartner) {
      const linkResult = await setKnownPartner(tandemJobId, savedPartner.email);
      if (!linkResult.success) {
        setTandemConfirming(false);
        setTandemError(linkResult.error ?? 'Failed to link known partner');
        return;
      }
    }

    setTandemConfirming(false);
    setTandemJob(tandemJobId, selectedMode);
  };

  if (!activeRide) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🏁</div>
        <div className="heading-editorial heading-editorial-md" style={{ marginBottom: 8 }}>No Active Ride</div>
        <Button onClick={() => navigate('/home')} variant="secondary">Go Home</Button>
      </div>
    );
  }

  // isNavigatingToPickup is computed from dispatch store above (before early returns)
  const destination = currentWaypoint
    ? { lat: currentWaypoint.lat, lng: currentWaypoint.lng, label: currentWaypoint.address }
    : isNavigatingToPickup
    ? { lat: activeRide.pickupLat, lng: activeRide.pickupLng, label: activeRide.pickupAddress }
    : { lat: activeRide.dropoffLat, lng: activeRide.dropoffLng, label: activeRide.dropoffAddress };

  // Build all waypoint pins for the map (remaining stops shown as numbered markers)
  const remainingWaypoints = waypoints && dispatch.stage === 'in_progress'
    ? waypoints.slice(currentWpIdx).map((wp, i) => ({
        lat: wp.lat,
        lng: wp.lng,
        label: wp.label ?? `Stop ${currentWpIdx + i + 1}`,
      }))
    : null;

  const handleOpenNav = () => {
    openNavigation(preferredNav, destination);
  };

  type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  const stageActions: Record<Exclude<ActiveRideStage, 'cancelled'>, { label: string; action: () => void; variant: ButtonVariant }> = {
    accepted: {
      label: `Navigate to Pickup (${getNavAppName(preferredNav)})`,
      action: async () => { await startNavigating(); handleOpenNav(); },
      variant: 'primary',
    },
    navigating: {
      label: activeRide.serviceType === 'rideshare' ? 'Passenger On Board'
        : activeRide.serviceType === 'delivery' ? 'Parcel Collected'
        : 'Arrived at Pickup',
      action: () => markArrived(),
      variant: 'primary',
    },
    arrived: {
      label: activeRide.serviceType === 'rideshare' ? 'Start Rideshare'
        : activeRide.serviceType === 'delivery' ? 'Start Delivery'
        : 'Start Ride',
      action: () => startRide(),
      variant: 'success',
    },
    in_progress: currentWaypoint && !isLastWaypoint ? {
      label: `Next Stop (${currentWpIdx + 1}/${waypoints?.length ?? 0}) →`,
      action: () => {
        advanceWaypoint();
        if (currentWaypoint) {
          openNavigation(preferredNav, { lat: currentWaypoint.lat, lng: currentWaypoint.lng, label: currentWaypoint.address });
        }
      },
      variant: 'primary' as const,
    } : {
      label: activeRide.serviceType === 'delivery' ? 'Mark as Delivered'
        : activeRide.serviceType === 'rideshare' ? 'Complete Rideshare'
        : 'Complete Ride',
      action: async () => {
        const result = await completeRide(activeRide.estimatedDistance);
        if (result?.success) {
          navigate(`/ride/${result.rideId}/complete`);
        } else if (result && 'queued' in result && result.queued) {
          setQueuedCompletion(true);
        }
      },
      variant: 'success' as const,
    },
    completing: { label: 'Processing…', action: () => {}, variant: 'secondary' },
    completed: { label: 'Completed', action: () => {}, variant: 'secondary' },
  };

  const currentAction = stageActions[activeRide.stage as Exclude<ActiveRideStage, 'cancelled'>];

  const serviceType = activeRide.serviceType ?? 'concierge';
  const stageSteps = serviceType === 'rideshare'
    ? [
        { key: 'navigating', label: 'En Route to Passenger', icon: '🚗' },
        { key: 'arrived', label: 'Passenger On Board', icon: '🧑' },
        { key: 'in_progress', label: 'Drop Off', icon: '🏁' },
      ]
    : serviceType === 'delivery'
    ? [
        { key: 'navigating', label: 'En Route to Pickup', icon: '🚗' },
        { key: 'arrived', label: 'Parcel Collected', icon: '📦' },
        { key: 'in_progress', label: 'En Route to Drop-off', icon: '🚚' },
        { key: 'delivered', label: 'Delivered', icon: '✅' },
      ]
    : [
        { key: 'navigating', label: 'En Route', icon: '🚗' },
        { key: 'arrived', label: 'Arrived', icon: '📍' },
        { key: 'in_progress', label: 'In Progress', icon: '🛣️' },
      ];

  const stageIndex = ['accepted', 'navigating'].includes(activeRide.stage) ? 0
    : activeRide.stage === 'arrived' ? 1
    : (activeRide.stage === 'completing' || activeRide.stage === 'completed') && serviceType === 'delivery' ? 3
    : 2;

  // ── Mode C liability dialog ──────────────────────────────────────────────────
  if (showModeCSafety && selectedMode === 'C') {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: colors.bgOverlay,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}>
        <Card style={{ maxWidth: 360, width: '100%' }} padding={28}>
          <div style={{ fontSize: 32, textAlign: 'center', marginBottom: 12 }}>⚠️</div>
          <div className="heading-editorial heading-editorial-md" style={{ textAlign: 'center', marginBottom: 12 }}>
            Self-Sufficient Acknowledgment
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6, marginBottom: 20 }}>
            By selecting Self-Sufficient (Mode C), you confirm that you will personally manage both vehicles for this tandem job. You accept full liability for any incidents involving the second vehicle and acknowledge that My Car Concierge is not responsible for co-driver arrangements made outside the platform.
          </div>
          {tandemError && (
            <div style={{ fontSize: 12, color: colors.error, marginBottom: 12, padding: '8px 12px', background: 'rgba(220,53,69,0.08)', borderRadius: borderRadius.sm }}>
              {tandemError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            <Button onClick={() => { setShowModeCSafety(false); setSelectedMode(null); }} variant="secondary" style={{ flex: 1 }}>
              Go Back
            </Button>
            <Button
              onClick={() => void handleConfirmTandemMode()}
              loading={tandemConfirming}
              variant="danger"
              style={{ flex: 1 }}
            >
              I Agree
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // ── Tandem Mode Selector panel ────────────────────────────────────────────────
  if (tandemRequired && !tandemModeConfirmed) {
    const modeCards: { mode: TandemMode; icon: string; label: string; subtitle: string; comingSoon?: boolean }[] = [
      { mode: 'A', icon: '🤝', label: 'Known Partner', subtitle: 'A pre-approved My Car Concierge ride-along driver you designate' },
      { mode: 'B', icon: '🔍', label: 'Platform Match', subtitle: 'My Car Concierge finds a verified co-driver for you' },
      { mode: 'C', icon: '🚘', label: 'Self-Sufficient', subtitle: 'You handle both vehicles and accept liability' },
    ];

    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
        <PageHeader title="Tandem Setup" />
        <div style={{ padding: 20, flex: 1 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: colors.navy, marginBottom: 4 }}>
              This ride requires a co-driver
            </div>
            <div style={{ fontSize: 13, color: colors.textMuted }}>
              Choose how you'd like to arrange the tandem vehicle.
              {tandemFee != null && (
                <span style={{ color: colors.gold, fontWeight: 600 }}> Ride-along fee: ${tandemFee}</span>
              )}
            </div>
          </div>

          {modeCards.map(({ mode, icon, label, subtitle, comingSoon }) => {
            const isSelected = selectedMode === mode;
            const isDisabled = comingSoon === true;
            return (
              <div
                key={mode}
                onClick={() => { if (!isDisabled) setSelectedMode(mode); }}
                style={{
                  padding: 16, borderRadius: borderRadius.md,
                  border: `2px solid ${isSelected ? colors.gold : colors.border}`,
                  background: isSelected ? 'rgba(201,152,46,0.06)' : colors.bgCard,
                  marginBottom: 12, cursor: isDisabled ? 'default' : 'pointer',
                  opacity: isDisabled ? 0.55 : 1,
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ fontSize: 28, flexShrink: 0 }}>{icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: colors.navy }}>
                        Mode {mode} — {label}
                      </div>
                      {comingSoon && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, color: colors.textMuted,
                          background: colors.bgSecondary, padding: '2px 6px',
                          borderRadius: borderRadius.full, border: `1px solid ${colors.border}`,
                        }}>
                          Coming Soon
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                      {subtitle}
                    </div>
                    {mode === 'A' && isSelected && (
                      <div style={{ marginTop: 10 }}>
                        {savedPartner ? (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 10px', borderRadius: borderRadius.sm,
                            background: colors.bgSecondary,
                          }}>
                            <div style={{
                              width: 32, height: 32, borderRadius: '50%',
                              background: colors.surfaceDark, display: 'flex',
                              alignItems: 'center', justifyContent: 'center',
                              fontSize: 12, fontWeight: 700, color: colors.gold, flexShrink: 0,
                            }}>
                              {savedPartner.firstName[0]}{savedPartner.lastName[0]}
                            </div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy }}>
                                {savedPartner.firstName} {savedPartner.lastName}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span className="badge-gold" style={{ fontSize: 9, padding: '1px 6px' }}>VERIFIED</span>
                                <span style={{ fontSize: 11, color: colors.textMuted }}>★ {savedPartner.rating.toFixed(1)}</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div style={{
                            padding: '10px 12px', borderRadius: borderRadius.sm,
                            background: colors.warningBg, fontSize: 12, color: colors.warning,
                          }}>
                            No partner saved yet. Go to Settings → Known Tandem Partner to add one.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${isSelected ? colors.gold : colors.border}`,
                    background: isSelected ? colors.gold : 'transparent',
                    marginTop: 2,
                  }} />
                </div>
              </div>
            );
          })}

          {tandemError && (
            <div style={{
              padding: '10px 14px', borderRadius: borderRadius.sm,
              background: 'rgba(220,53,69,0.08)', fontSize: 13, color: colors.error,
              marginBottom: 16,
            }}>
              {tandemError}
            </div>
          )}

          <Button
            onClick={() => void handleConfirmTandemMode()}
            disabled={!selectedMode || tandemConfirming}
            loading={tandemConfirming}
            variant="primary"
            fullWidth
            size="lg"
          >
            Confirm Mode {selectedMode ?? '—'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
      {/* Floating panic button */}
      <button
        onClick={() => navigate('/safety')}
        aria-label="Open safety screen"
        style={{
          position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)', left: 20,
          zIndex: 500, width: 52, height: 52, borderRadius: '50%',
          background: '#DC2626', border: '3px solid #FCA5A5',
          color: '#fff', fontSize: 22, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(220,38,38,0.5)',
        }}
      >
        🆘
      </button>

      {/* Trip chat panel */}
      {showChat && rideId && <TripChat rideId={rideId} onClose={() => setShowChat(false)} />}

      {/* Live map — driver position + current destination */}
      <div style={{ height: '35vh', position: 'relative' }}>
        <MapView
          center={driverPosition ?? { lat: destination.lat, lng: destination.lng }}
          driverPosition={driverPosition}
          destinations={remainingWaypoints ?? [{ lat: destination.lat, lng: destination.lng, label: destination.label }]}
          routePolyline={route?.polyline}
          zoom={15}
          style={{ height: '100%' }}
        />

        {/* Back button */}
        <button
          onClick={() => navigate('/home')}
          aria-label="Go back to home"
          style={{
            position: 'absolute', top: 'max(16px, env(safe-area-inset-top))', left: 16,
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)', border: 'none',
            color: '#fff', fontSize: 20, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ←
        </button>

        {/* Elapsed timer when ride is in progress */}
        {activeRide.stage === 'in_progress' && (
          <div style={{
            position: 'absolute', top: 'max(16px, env(safe-area-inset-top))', right: 64,
            background: colors.success, color: '#fff',
            padding: '6px 14px', borderRadius: borderRadius.full,
            fontSize: 18, fontWeight: 700, fontFamily: 'monospace',
            pointerEvents: 'none',
          }}>
            {elapsed}
          </div>
        )}

        {/* Chat button */}
        <button
          onClick={() => setShowChat(true)}
          aria-label="Open trip chat"
          style={{
            position: 'absolute', top: 'max(16px, env(safe-area-inset-top))', right: 16,
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(0,0,0,0.6)', border: 'none',
            color: '#fff', fontSize: 20, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          💬
        </button>

        {/* Live speed overlay — shown when publisher is active */}
        {isPublishing && currentSpeedMph !== null && (
          <div style={{ position: 'absolute', bottom: 12, right: 12 }}>
            <SpeedChip mph={currentSpeedMph} />
          </div>
        )}
      </div>

      {/* Content panel */}
      <div style={{
        flex: 1, padding: 20,
        borderRadius: `${borderRadius.xl}px ${borderRadius.xl}px 0 0`,
        marginTop: -16, background: colors.bgPrimary,
        position: 'relative',
      }}>
        {/* Speed onboarding banner — shown once when tracking first starts */}
        {isPublishing && !speedBannerDismissed && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'rgba(201,152,46,0.10)', border: '1px solid rgba(201,152,46,0.30)',
            borderRadius: borderRadius.md, padding: '10px 14px', marginBottom: 12,
          }}>
            <SpeedChip mph={currentSpeedMph} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, fontSize: 12, color: 'var(--accent-gold)', lineHeight: 1.4 }}>
              Your speed is visible to the member — MCC drivers share this as a trust signal.
            </div>
            <button
              onClick={() => {
                try { localStorage.setItem('mcc_speed_onboard_dismissed', '1'); } catch { /* ignore */ }
                setSpeedBannerDismissed(true);
              }}
              aria-label="Dismiss speed notice"
              style={{
                background: 'none', border: 'none', color: 'var(--accent-gold)',
                fontSize: 18, cursor: 'pointer', padding: '0 4px', flexShrink: 0,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* ETA / distance strip */}
        {route && (
          <div style={{
            display: 'flex', justifyContent: 'center', alignItems: 'stretch',
            gap: 0, marginBottom: 16,
            padding: '10px 0 14px',
            borderBottom: `1px solid ${colors.border}`,
          }}>
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: colors.navy, lineHeight: 1 }}>
                {route.etaMinutes}
                <span style={{ fontSize: 13, fontWeight: 500 }}> min</span>
              </div>
              <div style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 }}>ETA</div>
            </div>
            <div style={{ width: 1, background: colors.border, margin: '2px 0' }} />
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: colors.navy, lineHeight: 1 }}>
                {(route.distanceMeters / 1609.34).toFixed(1)}
                <span style={{ fontSize: 13, fontWeight: 500 }}> mi</span>
              </div>
              <div style={{ fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 3 }}>Away</div>
            </div>
          </div>
        )}

        {/* Progress steps */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginBottom: 20 }}>
          {stageSteps.map((s, i) => (
            <div key={s.key} style={{
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14,
                background: i <= stageIndex ? colors.navy : colors.bgSecondary,
                color: i <= stageIndex ? colors.textWhite : colors.textMuted,
              }}>
                {s.icon}
              </div>
              <span style={{
                fontSize: 11, fontWeight: i === stageIndex ? 700 : 400,
                color: i === stageIndex ? colors.navy : colors.textMuted,
              }}>
                {s.label}
              </span>
              {i < stageSteps.length - 1 && (
                <div style={{
                  width: 24, height: 2, borderRadius: 1,
                  background: i < stageIndex ? colors.navy : colors.borderLight,
                  margin: '0 4px',
                }} />
              )}
            </div>
          ))}
        </div>

        {/* Mode B platform match: show match card / waiting state.
            Gated by persisted tandem mode (not the transient local selector)
            so the panel survives remount/reload. */}
        {existingTandemJobId && tandemModeConfirmed && persistedTandemMode === 'B' && (
          <ProviderTandemMatchPanel tandemJobId={existingTandemJobId} />
        )}

        {/* Scenario & role */}
        <div style={{ marginBottom: 16 }}>
          <span className="eyebrow" style={{ marginBottom: 4 }}>Active Ride</span>
          <div className="heading-editorial heading-editorial-md">
            {getScenarioLabel(activeRide.scenario)}
          </div>
          <div style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>
            {getRoleDescription(
              activeRide.role ?? 'primary',
              activeRide.drivesMemberVehicle,
              activeRide.carriesPassenger,
              activeRide.memberVehicleDescription ?? undefined,
            )}
          </div>
        </div>

        {/* Destination card */}
        <Card style={{ marginBottom: 12 }} padding={14}>
          <div style={{ fontSize: 11, fontWeight: 600, color: currentWaypoint ? colors.warning : isNavigatingToPickup ? colors.info : colors.success, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            {currentWaypoint
              ? `📍 Stop ${currentWpIdx + 1} of ${waypoints?.length ?? 1}`
              : isNavigatingToPickup ? '📍 Navigating to Pickup' : '🏁 Navigating to Drop-off'}
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, color: colors.textPrimary }}>
            {destination.label}
          </div>
          {/* Remaining waypoints */}
          {remainingWaypoints && remainingWaypoints.length > 1 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {remainingWaypoints.slice(1).map((wp, i) => (
                <div key={i} style={{ fontSize: 12, color: colors.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%',
                    background: colors.bgSecondary, display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 10,
                    fontWeight: 700, color: colors.navy, flexShrink: 0,
                  }}>{currentWpIdx + i + 2}</span>
                  {wp.label}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Ride details */}
        <Card style={{ marginBottom: 16 }} padding={14}>
          <InfoRow icon="💰" label="Est. Fare" value={formatCurrency(activeRide.estimatedFare)} valueColor={colors.navy} />
          <InfoRow icon="📏" label="Distance" value={formatDistance(activeRide.estimatedDistance)} />
          {activeRide.memberVehicleDescription && (
            <InfoRow icon="🚙" label="Vehicle" value={activeRide.memberVehicleDescription} />
          )}
        </Card>

        {/* Open in nav app button */}
        {(activeRide.stage === 'navigating' || activeRide.stage === 'in_progress') && (
          <Button
            onClick={handleOpenNav}
            variant="secondary"
            fullWidth
            size="md"
            style={{ marginBottom: 12 }}
          >
            Open in {getNavAppName(preferredNav)} →
          </Button>
        )}

        {/* Wait timer banner (shown while in arrived stage) */}
        {activeRide.stage === 'arrived' && arrivedAtTs != null && (() => {
          const GRACE_MIN = 5;
          const NO_SHOW_MIN = 15;
          const elapsedMin = waitElapsedSec / 60;
          const billableMin = Math.max(0, elapsedMin - GRACE_MIN);
          const inGrace = elapsedMin < GRACE_MIN;
          const tripFareCents = (activeRide.estimatedFare ?? 0) * 100;
          const estimatedTripMin = Math.max(1, (activeRide.estimatedDistance / 30) * 60);
          const perMinCents = tripFareCents / estimatedTripMin;
          const isTandem = ['tier_3_vehicle_paired', 'tier_4_full_concierge'].includes(activeRide.tier ?? '');
          const waitCostCents = Math.round(billableMin * perMinCents * (isTandem ? 2 : 1));
          const mm = String(Math.floor(waitElapsedSec / 60)).padStart(2, '0');
          const ss = String(waitElapsedSec % 60).padStart(2, '0');
          const timeStr = `${mm}:${ss}`;
          return (
            <div style={{ marginBottom: 10 }}>
              <div style={{
                padding: '10px 14px', borderRadius: 10,
                background: inGrace ? 'rgba(250,247,240,0.06)' : 'rgba(245,158,11,0.1)',
                border: `1px solid ${inGrace ? 'rgba(250,247,240,0.12)' : 'rgba(245,158,11,0.35)'}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: inGrace ? colors.textMuted : 'rgba(245,158,11,0.9)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                    {inGrace ? `Grace period (${Math.ceil(GRACE_MIN - elapsedMin)} min left)` : isTandem ? 'Tandem wait time' : 'Wait time'}
                  </div>
                  <div style={{ fontSize: 13, color: inGrace ? colors.textSecondary : 'rgba(245,158,11,0.85)' }}>
                    {!inGrace && waitCostCents > 0 && `+$${(waitCostCents / 100).toFixed(2)}${isTandem ? ' (×2 drivers)' : ''}`}
                    {inGrace && 'No charge yet'}
                  </div>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: inGrace ? colors.textMuted : 'rgba(245,158,11,0.9)' }}>
                  {timeStr}
                </div>
              </div>

              {/* No-show button at 15 min */}
              {elapsedMin >= NO_SHOW_MIN && (
                <button
                  onClick={async () => {
                    if (!activeRide.assignmentId) return;
                    setNoShowLoading(true);
                    const result = await reportNoShow(activeRide.rideId, activeRide.assignmentId);
                    setNoShowLoading(false);
                    if (result.success) {
                      navigate('/home');
                    }
                  }}
                  disabled={noShowLoading}
                  style={{
                    marginTop: 8, width: '100%', padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)',
                    color: colors.error, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    opacity: noShowLoading ? 0.6 : 1,
                  }}
                >
                  {noShowLoading ? 'Processing…' : `Cancel — No Show (+$${((waitCostCents + 1500) / 100).toFixed(2)} earned)`}
                </button>
              )}

              {/* Undrivable — shown when driver is supposed to drive member's vehicle */}
              {activeRide.drivesMemberVehicle && (
                <button
                  onClick={async () => {
                    if (!activeRide.assignmentId) return;
                    setUndrivableLoading(true);
                    const result = await reportUndrivable(activeRide.rideId, activeRide.assignmentId);
                    setUndrivableLoading(false);
                    if (result.success) {
                      navigate('/home');
                    }
                  }}
                  disabled={undrivableLoading}
                  style={{
                    marginTop: 6, width: '100%', padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                    color: colors.error, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    opacity: undrivableLoading ? 0.6 : 1,
                  }}
                >
                  {undrivableLoading ? 'Processing…' : 'Vehicle Cannot Be Driven (+$15.00 earned)'}
                </button>
              )}
            </div>
          );
        })()}

        {/* Delivery confirmation reminder */}
        {activeRide.stage === 'in_progress' && serviceType === 'delivery' && (
          <div style={{
            background: 'rgba(212,104,10,0.08)', border: '1px solid rgba(212,104,10,0.3)',
            borderRadius: 10, padding: '10px 14px', marginBottom: 10,
            fontSize: 13, color: '#8B4513',
          }}>
            📋 Confirm delivery with the recipient before tapping "Mark as Delivered."
          </div>
        )}

        {/* Main action button */}
        {currentAction && (
          <Button
            onClick={currentAction.action}
            variant={currentAction.variant}
            fullWidth
            size="lg"
            loading={activeRide.stage === 'completing'}
            disabled={activeRide.stage === 'completing' || queuedCompletion}
            style={activeRide.stage === 'in_progress' ? {
              boxShadow: `0 6px 28px ${withAlpha(colors.success, '55')}`,
            } : undefined}
          >
            {currentAction.label}
          </Button>
        )}

        {queuedCompletion && (
          <div style={{
            marginTop: 12, padding: '10px 14px',
            background: 'rgba(245,158,11,0.1)',
            border: '1px solid rgba(245,158,11,0.35)',
            borderRadius: 8, fontSize: 13,
            color: 'rgba(245,158,11,0.9)', textAlign: 'center',
          }}>
            Ride saved locally — will sync when connected.
          </div>
        )}

        {/* Custody handoffs — shown for concierge service type */}
        {serviceType === 'concierge' && (
          <Button
            onClick={() => navigate(`/custody${rideId ? `?rideId=${rideId}` : ''}`)}
            variant="secondary"
            fullWidth
            size="sm"
            style={{ marginBottom: 8 }}
          >
            🔑 Custody Handoffs
          </Button>
        )}

        {/* Cancel option (driver-initiated) */}
        {['accepted', 'navigating', 'arrived'].includes(activeRide.stage) && (
          <>
            <Button
              onClick={() => setShowCancel(true)}
              variant="ghost"
              fullWidth
              size="sm"
              style={{ marginTop: 12, color: colors.error }}
            >
              Cancel Ride
            </Button>

            {showCancel && (
              <div style={{
                position: 'fixed', inset: 0, zIndex: 999,
                background: colors.bgOverlay,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 24,
              }}>
                <Card style={{ maxWidth: 340, width: '100%' }} padding={24}>
                  <div className="heading-editorial heading-editorial-md" style={{ marginBottom: 8 }}>
                    Cancel this ride?
                  </div>
                  <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
                    Cancelling after acceptance may affect your completion rate and future ride assignments.
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <Button onClick={() => setShowCancel(false)} variant="secondary" style={{ flex: 1 }}>
                      Keep Ride
                    </Button>
                    <Button onClick={() => { cancelRide('Driver cancelled'); navigate('/home'); }} variant="danger" style={{ flex: 1 }}>
                      Cancel
                    </Button>
                  </div>
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
