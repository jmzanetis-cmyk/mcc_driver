import React, { useEffect, useRef, useState } from 'react';
import { type IncomingRideRequest } from '@/hooks/useRideRequests';
import { Button, CountdownTimer, InfoRow, Card } from '@/components';
import { OfflineNotice, isOffline } from '@/components/OfflineNotice';
import { colors, borderRadius } from '@/theme';
import {
  formatCurrency, formatDistance, getScenarioLabel, getTierLabel,
  getRoleDescription, shortenAddress, getServiceTypeFromTier,
} from '@/utils/formatters';
import { getTierPricing } from '@/services/rides';
import { useDispatchStore } from '@/store/dispatchStore';

type DispatchOffer = ReturnType<typeof useDispatchStore.getState>;

interface RideRequestModalProps {
  request: DispatchOffer;
  onAccept: () => Promise<void>;
  onDecline: () => void;
  onExpired: () => void;
}

export function RideRequestModal({ request, onAccept, onDecline, onExpired }: RideRequestModalProps) {
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const acceptButtonRef = useRef<HTMLButtonElement>(null);

  // Focus management for the modal:
  // 1. On mount, move focus to the Accept button so a keyboard /
  //    VoiceOver user reaches the primary action immediately
  //    after the title is announced.
  // 2. Trap Tab/Shift+Tab inside the dialog while it is open so
  //    focus can't escape into the home screen behind it.
  // 3. Restore focus to whatever was focused before the modal
  //    opened when it unmounts.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Defer one frame so the SR can announce the title first,
    // then move focus to Accept (the primary action).
    const frame = requestAnimationFrame(() => {
      acceptButtonRef.current?.focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, []);

  const handleAccept = async () => {
    setAcceptError(null);
    if (isOffline()) {
      setAcceptError("You're offline. Reconnect and try again before the timer expires.");
      return;
    }
    setAccepting(true);
    try {
      await onAccept();
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : 'Could not accept — try again.');
    } finally {
      setAccepting(false);
    }
  };

  const tierColors: Record<string, string> = {
    tier_0_rideshare: '#1A6FC4',
    tier_0_delivery: '#D4680A',
    tier_1_passenger: '#2D6B8A',
    tier_2_vehicle_solo: colors.gold,
    tier_3_vehicle_paired: '#8A5C2D',
    tier_4_full_concierge: colors.surfaceDark,
  };

  const tier = request.tier ?? '';
  const tierColor = tierColors[tier] ?? colors.navy;
  const serviceType = getServiceTypeFromTier(tier);
  const scenario = request.scenario ?? '';
  const pickupAddress = request.pickupAddress ?? '';
  const dropoffAddress = request.dropoffAddress ?? '';
  const estimatedFare = request.estimatedFare ?? 0;
  const estimatedDistance = request.estimatedDistance ?? 0;
  const responseDeadline = request.responseDeadline ?? new Date(Date.now() + 30000).toISOString();
  const role = request.role ?? 'primary';
  const tierPricing = getTierPricing(tier as Parameters<typeof getTierPricing>[0]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ride-request-title"
      aria-describedby="ride-request-summary"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: colors.bgOverlay,
        display: 'flex', flexDirection: 'column',
        justifyContent: 'flex-end',
        animation: 'slideUp 0.3s ease',
      }}
    >
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        @media (prefers-reduced-motion: reduce) {
          [role="dialog"] { animation: none !important; }
        }
      `}</style>

      <div style={{
        background: colors.bgCard,
        borderRadius: `${borderRadius.xl}px ${borderRadius.xl}px 0 0`,
        padding: '24px 20px max(24px, env(safe-area-inset-bottom))',
        maxHeight: '85vh', overflowY: 'auto',
      }}>
        {/* Header with timer */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{
              fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: 0.8,
              color: serviceType === 'rideshare' ? '#1A6FC4'
                : serviceType === 'delivery' ? '#D4680A'
                : colors.gold,
              animation: 'pulse 1.5s infinite',
            }}>
              {serviceType === 'rideshare' ? '🚗 RIDESHARE REQUEST'
                : serviceType === 'delivery' ? '📦 DELIVERY REQUEST'
                : '🚘 CONCIERGE REQUEST'}
            </div>
            <h2 id="ride-request-title" style={{ fontSize: 20, fontWeight: 700, color: colors.navy, marginTop: 4, margin: 0 }}>
              {getScenarioLabel(scenario)}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <div style={{
                display: 'inline-block',
                fontSize: 11, fontWeight: 600, color: '#fff',
                background: tierColor, padding: '3px 10px',
                borderRadius: borderRadius.full,
              }}>
                {getTierLabel(tier)}
              </div>
              <div style={{
                display: 'inline-block',
                fontSize: 11, fontWeight: 600, color: tierColor,
                border: `1px solid ${tierColor}`, padding: '2px 8px',
                borderRadius: borderRadius.full,
              }}>
                ${tierPricing.perMile.toFixed(2)}/mi
              </div>
            </div>
          </div>
          <CountdownTimer
            deadline={responseDeadline}
            onExpired={onExpired}
            size={72}
          />
        </div>

        {/* Estimated fare */}
        <div
          id="ride-request-summary"
          aria-label={`Estimated earnings ${formatCurrency(estimatedFare * 0.85)} for a ${formatDistance(estimatedDistance)} trip from ${shortenAddress(pickupAddress)} to ${shortenAddress(dropoffAddress)}.`}
          style={{
            background: colors.surfaceDark, borderRadius: borderRadius.md,
            padding: 16, marginBottom: 16, textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 11, color: colors.gold, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Estimated Earnings
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: colors.textWhite, marginTop: 4 }}>
            {formatCurrency(estimatedFare * 0.85)}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
            {formatCurrency(estimatedFare)} fare × 85% driver share
          </div>
          {(serviceType === 'rideshare' || serviceType === 'delivery') && (
            <div style={{ fontSize: 11, color: colors.gold, marginTop: 4 }}>
              + per-minute rate added at completion
            </div>
          )}
        </div>

        {/* Your role */}
        <Card style={{ marginBottom: 12, background: colors.bgSecondary, border: 'none' }} padding={14}>
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            Your Role
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: colors.navy }}>
            {role === 'chase' ? '🚗 Chase Driver' : '🚘 Primary Driver'}
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4 }}>
            {getRoleDescription(
              role,
              request.drivesMemberVehicle,
              request.carriesPassenger,
              request.memberVehicleDescription ?? undefined
            )}
          </div>
        </Card>

        {/* Route details */}
        <Card style={{ marginBottom: 12 }} padding={14}>
          <InfoRow icon="📍" label="Pickup" value={shortenAddress(pickupAddress)} />
          <div style={{ borderTop: `1px dashed ${colors.borderLight}` }} />
          <InfoRow icon="🏁" label="Drop-off" value={shortenAddress(dropoffAddress)} />
          <div style={{ borderTop: `1px dashed ${colors.borderLight}` }} />
          <InfoRow icon="📏" label="Distance" value={formatDistance(estimatedDistance)} />
          {serviceType === 'rideshare' && (
            <>
              <div style={{ borderTop: `1px dashed ${colors.borderLight}` }} />
              <InfoRow icon="🧑" label="Passengers" value="1" />
            </>
          )}
        </Card>

        {/* Package description (for delivery rides) */}
        {serviceType === 'delivery' && request.packageDescription && (
          <Card style={{ marginBottom: 12, border: `1.5px solid #D4680A`, background: 'rgba(212,104,10,0.06)' }} padding={14}>
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              📦 Package
            </div>
            <div style={{ fontSize: 14, fontWeight: 500, color: colors.navy }}>
              {request.packageDescription}
            </div>
          </Card>
        )}

        {/* Member vehicle info (for vehicle shuttle scenarios) */}
        {request.drivesMemberVehicle && request.memberVehicleDescription && (
          <Card style={{ marginBottom: 12 }} padding={14}>
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
              Member's Vehicle
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: colors.navy }}>
              {request.memberVehicleDescription}
            </div>
          </Card>
        )}

        {/* Tandem Required badge + fee */}
        {request.tandemRequired && (
          <Card style={{ marginBottom: 12, border: `1.5px solid ${colors.gold}`, background: 'rgba(201,152,46,0.06)' }} padding={14}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: colors.navy,
                    background: colors.gold, padding: '2px 8px',
                    borderRadius: borderRadius.full, letterSpacing: 0.5,
                  }}>
                    TANDEM REQUIRED
                  </span>
                </div>
                <div style={{ fontSize: 12, color: colors.textMuted }}>
                  You'll select a co-driver mode after accepting
                </div>
              </div>
              {request.tandemFee != null && (
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: colors.gold }}>
                    +${request.tandemFee}
                  </div>
                  <div style={{ fontSize: 10, color: colors.textMuted }}>ride-along fee</div>
                </div>
              )}
            </div>
          </Card>
        )}

        <OfflineNotice style={{ marginBottom: 12 }} />
        {acceptError && (
          <div style={{
            marginBottom: 12, padding: '10px 12px',
            background: '#FEF2F2', border: '1px solid #FCA5A5',
            color: '#991B1B', borderRadius: 8, fontSize: 12, fontWeight: 600,
          }}>
            {acceptError}
          </div>
        )}
        {/* Accept / Decline buttons */}
        <div style={{ display: 'flex', gap: 12 }}>
          <Button
            onClick={onDecline}
            variant="secondary"
            size="lg"
            style={{ flex: 1 }}
          >
            Decline
          </Button>
          <Button
            onClick={handleAccept}
            loading={accepting}
            size="lg"
            style={{ flex: 2 }}
            buttonRef={acceptButtonRef}
          >
            Accept Ride
          </Button>
        </div>
      </div>
    </div>
  );
}
