// ============================================================
// MCC Driver — Home Dashboard Screen
// ============================================================

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/services/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useDriverStatus } from '@/hooks/useDriverStatus';
import { useRideRequests } from '@/hooks/useRideRequests';
import { useEarnings } from '@/hooks/useEarnings';
import { useDispatchStore } from '@/store/dispatchStore';
import { OnlineToggle, Card, StatCard, Button } from '@/components';
import { ThemeToggle } from '@/components/ThemeToggle';
import { colors, borderRadius } from '@/theme';
import { formatCurrency, getStarDisplay } from '@/utils/formatters';
import { RideRequestModal } from './RideRequestScreen';

export function HomeScreen() {
  const navigate = useNavigate();
  const { driver, signOut } = useAuth();
  const { isOnline, isToggling, toggleOnline, currentLat, currentLng } = useDriverStatus(driver?.id || null);
  const { incomingRequest, acceptRide, declineRide, dismissRequest } = useRideRequests(driver?.id || null, isOnline);
  const { summary } = useEarnings(driver?.id || null);

  const serverCancelled = useDispatchStore((s) => s.serverCancelled);
  const setServerCancelled = useDispatchStore((s) => s.setServerCancelled);

  // Gate the Ride-Along Dashboard entry by checking the caller's
  // ride_along_drivers profile. Only drivers with a record see the card.
  const [hasRideAlongProfile, setHasRideAlongProfile] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        const base = import.meta.env.BASE_URL.replace(/\/$/, '');
        const res = await fetch(`${base}/api/ride-along-drivers/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled) setHasRideAlongProfile(res.ok);
      } catch {
        if (!cancelled) setHasRideAlongProfile(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!driver) return null;

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      {/* Header */}
      <div style={{
        background: colors.surfaceDark, padding: '20px 20px 24px',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThemeToggle />
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

        {/* Ride-Along Driver Dashboard entry — visible only to drivers
            with an existing ride_along_drivers record. */}
        {hasRideAlongProfile && (
          <Card
            onClick={() => navigate('/ride-along')}
            style={{ marginTop: 12, cursor: 'pointer', border: `1px solid ${colors.gold}` }}
            padding={14}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 24 }}>🚖</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>Ride-Along Jobs</div>
                <div style={{ fontSize: 12, color: colors.textMuted }}>Tandem dashboard — live broadcasts & matches</div>
              </div>
              <div style={{ fontSize: 18, color: colors.gold }}>→</div>
            </div>
          </Card>
        )}

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

      {/* Ride cancelled by member/dispatcher notification */}
      {serverCancelled && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: colors.bgOverlay,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}>
          <Card style={{ maxWidth: 340, width: '100%' }} padding={28}>
            <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 12 }}>🚫</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: colors.navy, textAlign: 'center', marginBottom: 8 }}>
              Ride Cancelled
            </div>
            <div style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', marginBottom: 24, lineHeight: 1.5 }}>
              This ride was cancelled by the member or your dispatcher. You won't be penalised — you're back online and ready for new assignments.
            </div>
            <Button
              onClick={() => setServerCancelled(false)}
              variant="primary"
              fullWidth
            >
              Got it
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
