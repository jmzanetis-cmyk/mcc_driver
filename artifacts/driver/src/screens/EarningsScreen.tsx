// ============================================================
// MCC Driver — Earnings Screen
// ============================================================

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useEarnings, type RideEarning } from '@/hooks/useEarnings';
import { PageHeader, Card, StatCard, Spinner } from '@/components';
import { colors, borderRadius, shadows } from '@/theme';
import {
  formatCurrency, formatDistance, formatDate, formatTime,
  getScenarioLabel, getStarDisplay,
} from '@/utils/formatters';

type Period = 'today' | 'week' | 'all';

export function EarningsScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const { summary, recentRides, isLoading } = useEarnings(driver?.id || null);
  const [period, setPeriod] = useState<Period>('week');

  const filteredRides = recentRides.filter(ride => {
    if (period === 'all') return true;
    const now = new Date();
    const rideDate = new Date(ride.completedAt);
    if (period === 'today') {
      return rideDate.toDateString() === now.toDateString();
    }
    // this week
    const weekStart = new Date(now.getTime() - now.getDay() * 86400000);
    weekStart.setHours(0, 0, 0, 0);
    return rideDate >= weekStart;
  });

  const periodEarnings = period === 'today' ? summary.today
    : period === 'week' ? summary.thisWeek
    : summary.allTime;

  const periodRides = period === 'today' ? summary.ridesToday
    : period === 'week' ? summary.ridesThisWeek
    : summary.ridesAllTime;

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Earnings" onBack={() => navigate('/home')} />

      <div style={{ padding: 20 }}>
        {/* Period tabs */}
        <div style={{
          display: 'flex', background: colors.bgSecondary,
          borderRadius: borderRadius.md, padding: 4, marginBottom: 20,
        }}>
          {(['today', 'week', 'all'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                borderRadius: borderRadius.sm, fontSize: 13, fontWeight: 600,
                background: period === p ? colors.bgCard : 'transparent',
                color: period === p ? colors.navy : colors.textMuted,
                boxShadow: period === p ? shadows.sm : 'none',
                transition: 'all 0.2s',
              }}
            >
              {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : 'All Time'}
            </button>
          ))}
        </div>

        {/* Summary cards */}
        <div style={{
          background: colors.navy, borderRadius: borderRadius.lg,
          padding: 20, marginBottom: 20, textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, color: colors.gold, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Total Earnings
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, color: colors.textWhite, margin: '8px 0' }}>
            {formatCurrency(periodEarnings)}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
            {periodRides} ride{periodRides !== 1 ? 's' : ''} completed
          </div>

          {/* Instant Pay button inside the navy card */}
          <button
            onClick={() => navigate('/instant-pay')}
            style={{
              marginTop: 16, padding: '12px 24px',
              background: colors.gold, color: colors.navy,
              border: 'none', borderRadius: borderRadius.full,
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}
          >
            ⚡ Cash Out Now
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
          <StatCard label="Avg / Ride" value={periodRides > 0 ? formatCurrency(periodEarnings / periodRides) : '--'} />
          <StatCard label="Rating" value={summary.averageRating.toFixed(1)} sublabel={getStarDisplay(summary.averageRating)} color={colors.gold} />
        </div>

        {/* Ride history */}
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          Ride History
        </div>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <Spinner color={colors.textMuted} />
          </div>
        ) : filteredRides.length === 0 ? (
          <Card padding={24}>
            <div style={{ textAlign: 'center', color: colors.textMuted }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🚗</div>
              <div style={{ fontSize: 14 }}>No rides for this period</div>
            </div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredRides.map(ride => (
              <RideHistoryCard key={ride.rideId} ride={ride} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Ride History Card
// ============================================================

function RideHistoryCard({ ride }: { ride: RideEarning }) {
  const total = ride.driverPayout + ride.tip;

  return (
    <Card padding={14}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>
            {getScenarioLabel(ride.scenario)}
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
            {formatDate(ride.completedAt)} at {formatTime(ride.completedAt)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: colors.navy }}>
            {formatCurrency(total)}
          </div>
          {ride.tip > 0 && (
            <div style={{ fontSize: 11, color: colors.success }}>
              +{formatCurrency(ride.tip)} tip
            </div>
          )}
        </div>
      </div>

      <div style={{
        display: 'flex', gap: 16, fontSize: 12, color: colors.textMuted,
        borderTop: `1px solid ${colors.borderLight}`, paddingTop: 8,
      }}>
        <span>📏 {formatDistance(ride.distanceMiles)}</span>
        {ride.rating !== undefined && (
          <span>⭐ {ride.rating}/5</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: colors.textMuted }}>
          {ride.pickupAddress.split(',')[0]} → {ride.dropoffAddress.split(',')[0]}
        </span>
      </div>
    </Card>
  );
}


