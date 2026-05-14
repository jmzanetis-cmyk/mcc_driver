// ============================================================
// MCC Driver — Home Dashboard Screen
// ============================================================

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useDriverStatus } from '@/hooks/useDriverStatus';
import { useRideRequests } from '@/hooks/useRideRequests';
import { useEarnings } from '@/hooks/useEarnings';
import { OnlineToggle, Card, StatCard } from '@/components';
import { colors, borderRadius } from '@/theme';
import { formatCurrency, getStarDisplay } from '@/utils/formatters';
import { RideRequestModal } from './RideRequestScreen';

export function HomeScreen() {
  const navigate = useNavigate();
  const { driver, signOut } = useAuth();
  const { isOnline, isToggling, toggleOnline, currentLat, currentLng } = useDriverStatus(driver?.id || null);
  const { incomingRequest, acceptRide, declineRide, dismissRequest } = useRideRequests(driver?.id || null, isOnline);
  const { summary } = useEarnings(driver?.id || null);

  if (!driver) return null;

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      {/* Header */}
      <div style={{
        background: colors.navy, padding: '20px 20px 24px',
        borderRadius: `0 0 ${borderRadius.xl}px ${borderRadius.xl}px`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 14, color: colors.gold, marginBottom: 2 }}>
              Welcome back
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: colors.textWhite }}>
              {driver.firstName} {driver.lastName}
            </div>
          </div>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            background: 'rgba(201,152,46,0.15)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: colors.gold,
            cursor: 'pointer',
          }} onClick={() => navigate('/settings')}>
            {driver.firstName[0]}{driver.lastName[0]}
          </div>
        </div>

        {/* Online toggle */}
        <OnlineToggle isOnline={isOnline} isToggling={isToggling} onToggle={toggleOnline} />
      </div>

      <div style={{ padding: 20 }}>
        {/* Today's earnings */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            Today
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <StatCard label="Earned" value={formatCurrency(summary.today)} sublabel={`${summary.ridesToday} ride${summary.ridesToday !== 1 ? 's' : ''}`} color={colors.navy} />
            <StatCard label="Rating" value={summary.averageRating.toFixed(1)} sublabel={getStarDisplay(summary.averageRating)} color={colors.gold} />
          </div>
        </div>

        {/* This week */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            This Week
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <StatCard label="Earned" value={formatCurrency(summary.thisWeek)} sublabel={`${summary.ridesThisWeek} rides`} />
            <StatCard label="All Time" value={formatCurrency(summary.allTime)} sublabel={`${summary.ridesAllTime} rides`} />
          </div>
        </div>

        {/* Quick actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          <Card onClick={() => navigate('/earnings')} style={{ flex: 1, cursor: 'pointer' }} padding={14}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>💰</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy }}>Earnings</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>View details</div>
          </Card>
          <Card onClick={() => navigate('/scheduled')} style={{ flex: 1, cursor: 'pointer' }} padding={14}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>📅</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy }}>Scheduled</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>Upcoming rides</div>
          </Card>
          <Card onClick={() => navigate('/settings')} style={{ flex: 1, cursor: 'pointer' }} padding={14}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>⚙️</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy }}>Settings</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>Profile & prefs</div>
          </Card>
        </div>

        {/* AI Support button */}
        <Card onClick={() => navigate('/support')} style={{ marginTop: 12, cursor: 'pointer', border: `1px solid ${colors.gold}` }} padding={14}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 24 }}>🤖</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>AI Support</div>
              <div style={{ fontSize: 12, color: colors.textMuted }}>Earnings, vehicles, payouts, help & more</div>
            </div>
            <div style={{ fontSize: 18, color: colors.gold }}>→</div>
          </div>
        </Card>

        {/* Status indicator */}
        {isOnline && (
          <div style={{
            marginTop: 20, padding: 16, background: colors.successBg,
            borderRadius: borderRadius.md, textAlign: 'center',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.success }}>
              🟢 You're online and accepting rides
            </div>
            <div style={{ fontSize: 12, color: colors.success, marginTop: 4 }}>
              Ride requests will appear as a popup when available
            </div>
          </div>
        )}
      </div>

      {/* Incoming ride request modal */}
      {incomingRequest && (
        <RideRequestModal
          request={incomingRequest}
          onAccept={async () => {
            const result = await acceptRide();
            if (result.success) {
              navigate(`/ride/${incomingRequest.rideId}/navigate`);
            }
          }}
          onDecline={() => declineRide()}
          onExpired={() => dismissRequest()}
        />
      )}
    </div>
  );
}
