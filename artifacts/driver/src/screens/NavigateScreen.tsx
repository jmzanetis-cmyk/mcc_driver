// ============================================================
// MCC Driver — Navigate Screen
// ============================================================
// Shows pickup/dropoff info and launches preferred nav app.
// Also handles external ride cancellation — when a member or
// admin cancels after the driver has accepted, a full-screen
// overlay is shown and the driver is returned to home.
// ============================================================

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useActiveRide, type ActiveRideStage } from '@/hooks/useActiveRide';
import { useAuth } from '@/hooks/useAuth';
import { useDispatchStore } from '@/store/dispatchStore';
import { openNavigation, getNavAppName, type NavApp } from '@/services/navigation/navService';
import { Button, Card, InfoRow, PageHeader, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import {
  formatCurrency, formatDistance, getScenarioLabel, getTierLabel,
  getRoleDescription, shortenAddress, formatElapsed,
} from '@/utils/formatters';

export function NavigateScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const {
    activeRide, startNavigating, markArrived, startRide,
    completeRide, cancelRide,
  } = useActiveRide();

  // Used by the cancelled overlay to clear dispatch and show cancellation reason
  const dispatch = useDispatchStore();

  const [preferredNav, setPreferredNav] = useState<NavApp>('google_maps');
  const [elapsed, setElapsed] = useState('0:00');
  const [showCancel, setShowCancel] = useState(false);
  const [countdown, setCountdown] = useState(5);

  // Load preferred nav from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('mcc_preferred_nav') as NavApp | null;
    if (saved) setPreferredNav(saved);
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
          <div style={{ fontSize: 22, fontWeight: 700, color: colors.navy, marginBottom: 8 }}>
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

  if (!activeRide) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🏁</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: colors.navy, marginBottom: 8 }}>No Active Ride</div>
        <Button onClick={() => navigate('/home')} variant="secondary">Go Home</Button>
      </div>
    );
  }

  const isNavigatingToPickup = activeRide.stage === 'accepted' || activeRide.stage === 'navigating';
  const destination = isNavigatingToPickup
    ? { lat: activeRide.pickupLat, lng: activeRide.pickupLng, label: activeRide.pickupAddress }
    : { lat: activeRide.dropoffLat, lng: activeRide.dropoffLng, label: activeRide.dropoffAddress };

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
      label: "I've Arrived at Pickup",
      action: () => markArrived(),
      variant: 'primary',
    },
    arrived: {
      label: 'Start Ride',
      action: () => startRide(),
      variant: 'success',
    },
    in_progress: {
      label: 'Complete Ride',
      action: async () => {
        const result = await completeRide(activeRide.estimatedDistance);
        if (result.success) {
          navigate(`/ride/${result.rideId}/complete`);
        }
      },
      variant: 'success',
    },
    completing: { label: 'Processing...', action: () => {}, variant: 'secondary' },
    completed: { label: 'Completed', action: () => {}, variant: 'secondary' },
  };

  const currentAction = stageActions[activeRide.stage as Exclude<ActiveRideStage, 'cancelled'>];

  const stageSteps = [
    { key: 'navigating', label: 'En Route', icon: '🚗' },
    { key: 'arrived', label: 'Arrived', icon: '📍' },
    { key: 'in_progress', label: 'In Progress', icon: '🛣️' },
  ];

  const stageIndex = ['accepted', 'navigating'].includes(activeRide.stage) ? 0
    : activeRide.stage === 'arrived' ? 1
    : 2;

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
      {/* Map placeholder */}
      <div style={{
        height: '35vh', background: colors.navy,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🗺️</div>
          <div style={{ fontSize: 13 }}>Map view — Google Maps SDK</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>Will render here in production</div>
        </div>

        {/* Back button overlay */}
        <button
          onClick={() => navigate('/home')}
          style={{
            position: 'absolute', top: 'max(16px, env(safe-area-inset-top))', left: 16,
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(0,0,0,0.5)', border: 'none',
            color: '#fff', fontSize: 20, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          ←
        </button>

        {/* In-progress timer overlay */}
        {activeRide.stage === 'in_progress' && (
          <div style={{
            position: 'absolute', top: 'max(16px, env(safe-area-inset-top))', right: 16,
            background: colors.success, color: '#fff',
            padding: '6px 14px', borderRadius: borderRadius.full,
            fontSize: 16, fontWeight: 700, fontFamily: 'monospace',
          }}>
            {elapsed}
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

        {/* Scenario & role */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: colors.navy }}>
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
          <div style={{ fontSize: 11, fontWeight: 600, color: isNavigatingToPickup ? colors.info : colors.success, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            {isNavigatingToPickup ? '📍 Navigating to Pickup' : '🏁 Navigating to Drop-off'}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: colors.textPrimary }}>
            {isNavigatingToPickup ? activeRide.pickupAddress : activeRide.dropoffAddress}
          </div>
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
            size="sm"
            style={{ marginBottom: 12 }}
          >
            Open in {getNavAppName(preferredNav)} →
          </Button>
        )}

        {/* Main action button */}
        {currentAction && (
          <Button
            onClick={currentAction.action}
            variant={currentAction.variant}
            fullWidth
            size="lg"
            loading={activeRide.stage === 'completing'}
            disabled={activeRide.stage === 'completing'}
          >
            {currentAction.label}
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
                  <div style={{ fontSize: 18, fontWeight: 600, color: colors.navy, marginBottom: 8 }}>
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
