import React, { useState } from 'react';
import { type IncomingRideRequest } from '@/hooks/useRideRequests';
import { Button, CountdownTimer, InfoRow, Card } from '@/components';
import { colors, borderRadius } from '@/theme';
import {
  formatCurrency, formatDistance, getScenarioLabel, getTierLabel,
  getRoleDescription, shortenAddress,
} from '@/utils/formatters';
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

  const handleAccept = async () => {
    setAccepting(true);
    await onAccept();
    setAccepting(false);
  };

  const tierColors: Record<string, string> = {
    tier_1_passenger: '#2D6B8A',
    tier_2_vehicle_solo: colors.gold,
    tier_3_vehicle_paired: '#8A5C2D',
    tier_4_full_concierge: colors.navy,
  };

  const tier = request.tier ?? '';
  const tierColor = tierColors[tier] ?? colors.navy;
  const scenario = request.scenario ?? '';
  const pickupAddress = request.pickupAddress ?? '';
  const dropoffAddress = request.dropoffAddress ?? '';
  const estimatedFare = request.estimatedFare ?? 0;
  const estimatedDistance = request.estimatedDistance ?? 0;
  const responseDeadline = request.responseDeadline ?? new Date(Date.now() + 30000).toISOString();
  const role = request.role ?? 'primary';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: colors.bgOverlay,
      display: 'flex', flexDirection: 'column',
      justifyContent: 'flex-end',
      animation: 'slideUp 0.3s ease',
    }}>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
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
              letterSpacing: 0.8, color: tierColor,
              animation: 'pulse 1.5s infinite',
            }}>
              NEW RIDE REQUEST
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: colors.navy, marginTop: 4 }}>
              {getScenarioLabel(scenario)}
            </div>
            <div style={{
              display: 'inline-block', marginTop: 6,
              fontSize: 11, fontWeight: 600, color: '#fff',
              background: tierColor, padding: '3px 10px',
              borderRadius: borderRadius.full,
            }}>
              {getTierLabel(tier)}
            </div>
          </div>
          <CountdownTimer
            deadline={responseDeadline}
            onExpired={onExpired}
            size={72}
          />
        </div>

        {/* Estimated fare */}
        <div style={{
          background: colors.navy, borderRadius: borderRadius.md,
          padding: 16, marginBottom: 16, textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, color: colors.gold, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Estimated Earnings
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: colors.textWhite, marginTop: 4 }}>
            {formatCurrency(estimatedFare * 0.85)}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
            {formatCurrency(estimatedFare)} fare × 85% driver share
          </div>
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
        </Card>

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
          >
            Accept Ride
          </Button>
        </div>
      </div>
    </div>
  );
}
