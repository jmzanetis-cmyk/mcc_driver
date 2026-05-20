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
import { OnlineToggle, Card, StatCard, Button, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { formatCurrency, getStarDisplay } from '@/utils/formatters';
import { RideRequestModal } from './RideRequestScreen';

export function HomeScreen() {
  const navigate = useNavigate();
  const { driver, signOut } = useAuth();
  const { isOnline, isToggling, toggleOnline, currentLat, currentLng } = useDriverStatus(driver?.id || null);
  const { incomingRequest, acceptRide, declineRide, dismissRequest } = useRideRequests(driver?.id || null, isOnline);
  const { summary, isLoading: earningsLoading, isError: earningsError, refreshEarnings } = useEarnings(driver?.id || null);

  const serverCancelled = useDispatchStore((s) => s.serverCancelled);
  const setServerCancelled = useDispatchStore((s) => s.setServerCancelled);

  // Gate the Ride-Along Dashboard entry by checking the caller's
  // ride_along_drivers profile. Only drivers with a record see the card.
  // We treat a network failure as "unknown" rather than "no profile" so
  // an offline launch doesn't hide the entry from drivers who DO have a
  // record — the card simply stays hidden until the lookup succeeds.
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
        if (!cancelled && res.ok) setHasRideAlongProfile(true);
      } catch {
        // Swallow — leave hasRideAlongProfile in its current state.
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
            <span className="eyebrow on-dark" style={{ marginBottom: 6 }}>
              Welcome back
            </span>
            <h1 className="heading-editorial heading-editorial-lg on-dark" style={{ marginTop: 4 }}>
              {driver.firstName} {driver.lastName}
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={() => navigate('/settings')}
              aria-label={`Open settings for ${driver.firstName} ${driver.lastName}`}
              style={{
                width: 44, height: 44, borderRadius: '50%',
                background: 'rgba(201,152,46,0.15)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, color: colors.gold,
                cursor: 'pointer', border: 'none', padding: 0,
                fontFamily: 'inherit',
              }}
            >
              <span aria-hidden="true">{driver.firstName[0]}{driver.lastName[0]}</span>
            </button>
          </div>
        </div>

        {/* Online toggle */}
        <OnlineToggle isOnline={isOnline} isToggling={isToggling} onToggle={toggleOnline} />
      </div>

      <div style={{ padding: 20 }}>
        {earningsError && (
          <Card padding={14} style={{ marginBottom: 16, border: `1px solid ${colors.error}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontSize: 13, color: colors.error, fontWeight: 600 }}>
                Couldn't refresh today's earnings.
              </div>
              <button
                onClick={() => { void refreshEarnings(); }}
                style={{
                  padding: '6px 12px', background: colors.navy, color: colors.textWhite,
                  border: 'none', borderRadius: borderRadius.full,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          </Card>
        )}
        {earningsLoading && !earningsError && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 8, marginBottom: 4 }}>
            <Spinner size={16} color={colors.textMuted} />
          </div>
        )}
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
              Your next ride will appear here as soon as one is dispatched.
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
            } else {
              // Surface the failure to RideRequestModal so it can show
              // the inline acceptError banner instead of silently
              // re-enabling the button with no feedback.
              throw new Error(
                (result as { error?: string }).error
                  ?? "Couldn't accept that ride. Try again or wait for the next offer.",
              );
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
            <div className="heading-editorial heading-editorial-md" style={{ textAlign: 'center', marginBottom: 8 }}>
              Ride Cancelled
            </div>
            <div style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', marginBottom: 24, lineHeight: 1.5 }}>
              This ride was cancelled by the member or your dispatcher. Your rating is unaffected — you're back online and ready for the next assignment.
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
