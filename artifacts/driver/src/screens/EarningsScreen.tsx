// ============================================================
// MCC Driver — Earnings Screen
// ============================================================

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Car, BarChart2, Receipt, Trophy } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useEarnings, type RideEarning, type PayoutRecord } from '@/hooks/useEarnings';
import { PageHeader, Card, StatCard, Spinner } from '@/components';
import { DailyEarningsChart } from '@/components/DailyEarningsChart';
import { colors, borderRadius, shadows } from '@/theme';
import {
  formatCurrency, formatDistance, formatDate, formatTime,
  getScenarioLabel, getStarDisplay,
} from '@/utils/formatters';

type Period = 'today' | 'week' | 'month' | 'all';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  week: 'This Week',
  month: 'This Month',
  all: 'All Time',
};

export function EarningsScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const { summary, recentRides, payouts, availableCents, isLoading, isError, refreshEarnings } = useEarnings(driver?.id || null);
  const [period, setPeriod] = useState<Period>('week');

  const filteredRides = recentRides.filter(ride => {
    if (period === 'all') return true;
    const now = new Date();
    const rideDate = new Date(ride.completedAt);
    if (period === 'today') return rideDate.toDateString() === now.toDateString();
    if (period === 'week') {
      const weekStart = new Date(now.getTime() - now.getDay() * 86400000);
      weekStart.setHours(0, 0, 0, 0);
      return rideDate >= weekStart;
    }
    // month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return rideDate >= monthStart;
  });

  const periodEarnings =
    period === 'today' ? summary.today
    : period === 'week' ? summary.thisWeek
    : period === 'month' ? summary.thisMonth
    : summary.allTime;

  const periodRides =
    period === 'today' ? summary.ridesToday
    : period === 'week' ? summary.ridesThisWeek
    : period === 'month' ? summary.ridesThisMonth
    : summary.ridesAllTime;

  const unpaidBalance = availableCents / 100;

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Earnings" onBack={() => navigate('/home')} />

      <div style={{ padding: 20 }}>
        {/* Period tabs */}
        <div style={{
          display: 'flex', background: colors.bgSecondary,
          borderRadius: borderRadius.md, padding: 4, marginBottom: 20,
        }}>
          {(['today', 'week', 'month', 'all'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                borderRadius: borderRadius.sm, fontSize: 12, fontWeight: 600,
                background: period === p ? colors.bgCard : 'transparent',
                color: period === p ? colors.navy : colors.textMuted,
                boxShadow: period === p ? shadows.sm : 'none',
                transition: 'all 0.2s', fontFamily: 'inherit',
              }}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>

        {/* Hero earnings card */}
        <div style={{
          background: colors.surfaceDark, borderRadius: borderRadius.lg,
          padding: 20, marginBottom: 16, textAlign: 'center',
        }}>
          <span className="eyebrow on-dark">{PERIOD_LABELS[period]} Earnings</span>
          <div className="heading-editorial heading-editorial-xl on-dark" style={{ margin: '8px 0', fontSize: 'clamp(2rem, 8vw, 2.75rem)' }}>
            {formatCurrency(periodEarnings)}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
            {periodRides} ride{periodRides !== 1 ? 's' : ''} completed
          </div>

          {/* Cash Out button */}
          <button
            onClick={() => navigate('/instant-pay')}
            style={{
              marginTop: 16, padding: '12px 24px',
              background: colors.gold, color: colors.navy,
              border: 'none', borderRadius: borderRadius.full,
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 8,
              fontFamily: 'inherit',
            }}
          >
            ⚡ Cash Out Now
          </button>
        </div>

        {/* All-time breakdown: fares vs tips */}
        <Card style={{ marginBottom: 16 }} padding={16}>
          <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            Earnings Breakdown (All Time)
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, textAlign: 'center', padding: '10px 0', background: colors.bgSecondary, borderRadius: borderRadius.sm }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: colors.navy }}>{formatCurrency(summary.totalFares)}</div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 3 }}>Ride Fares</div>
            </div>
            <div style={{ flex: 1, textAlign: 'center', padding: '10px 0', background: 'rgba(52,211,153,0.08)', borderRadius: borderRadius.sm }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: colors.success }}>{formatCurrency(summary.totalTips)}</div>
              <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 3 }}>Tips</div>
            </div>
          </div>
        </Card>

        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <StatCard label="Avg / Ride" value={periodRides > 0 ? formatCurrency(periodEarnings / periodRides) : '--'} />
          <StatCard label="Rating" value={summary.averageRating.toFixed(1)} sublabel={getStarDisplay(summary.averageRating)} color={colors.gold} />
        </div>

        {/* Service-type breakdown */}
        {filteredRides.length > 0 && <ServiceBreakdown rides={filteredRides} />}

        {/* Daily chart */}
        {period !== 'today' && <DailyEarningsChart rides={filteredRides} period={period === 'month' ? 'week' : period} />}

        {/* Financial Tools */}
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
          Financial Tools
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {([
            { path: '/mileage',       Icon: Car,       label: 'Mileage',   sublabel: 'IRS deduction' },
            { path: '/expenses',      Icon: Receipt,   label: 'Expenses',  sublabel: 'Business costs' },
            { path: '/tax-estimator', Icon: BarChart2, label: 'Tax Est.',  sublabel: 'Quarterly' },
            { path: '/leaderboard',   Icon: Trophy,    label: 'Rankings',  sublabel: 'Top drivers' },
          ] as const).map(({ path, Icon, label, sublabel }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              style={{
                flex: 1, padding: '12px 4px', background: colors.bgCard,
                border: `1px solid ${colors.borderLight}`, borderRadius: borderRadius.md,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'center',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
                <Icon size={20} color={colors.gold} strokeWidth={1.5} aria-hidden="true" />
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.navy }}>{label}</div>
              <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 1 }}>{sublabel}</div>
            </button>
          ))}
        </div>

        {/* Payout History */}
        {payouts.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
              Payout History
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {payouts.map((p) => <PayoutCard key={p.id} payout={p} />)}
            </div>
          </>
        )}

        {/* Ride History */}
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          Ride History
        </div>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}><Spinner color={colors.textMuted} /></div>
        ) : isError ? (
          <Card padding={24}>
            <div style={{ textAlign: 'center', color: colors.textMuted }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                <AlertCircle size={32} color={colors.warning} strokeWidth={1.5} aria-hidden="true" />
              </div>
              <div style={{ fontSize: 14, marginBottom: 12 }}>Couldn't load your earnings. Check your connection and try again.</div>
              <button
                onClick={() => { void refreshEarnings(); }}
                style={{ padding: '10px 20px', background: colors.navy, color: colors.textWhite, border: 'none', borderRadius: borderRadius.full, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Retry
              </button>
            </div>
          </Card>
        ) : filteredRides.length === 0 ? (
          <Card padding={24}>
            <div style={{ textAlign: 'center', color: colors.textMuted }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                <Car size={32} color={colors.textMuted} strokeWidth={1.5} aria-hidden="true" />
              </div>
              <div style={{ fontSize: 14 }}>No rides for this period</div>
            </div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredRides.map(ride => <RideHistoryCard key={ride.rideId} ride={ride} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Payout History Card ──────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string }> = {
  processing:  { label: 'Processing',  color: colors.warning },
  in_transit:  { label: 'In Transit',  color: colors.info ?? '#2563EB' },
  paid:        { label: 'Paid',        color: colors.success },
  failed:      { label: 'Failed',      color: colors.error },
};

function PayoutCard({ payout }: { payout: PayoutRecord }) {
  const meta = STATUS_META[payout.status] ?? { label: payout.status, color: colors.textMuted };
  const displayAmount = payout.netPayout ?? payout.amount;
  const destination = payout.method === 'instant'
    ? (payout.cardLast4 ? `Debit ••${payout.cardLast4}` : 'Debit card')
    : (payout.bankLast4 ? `Bank ••${payout.bankLast4}` : 'Bank account');

  return (
    <Card padding={14}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 15 }}>{payout.method === 'instant' ? '⚡' : '🏦'}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: colors.navy }}>
              {payout.method === 'instant' ? 'Instant Payout' : 'Standard Payout'}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, color: meta.color,
              background: `${meta.color}18`, padding: '2px 8px',
              borderRadius: borderRadius.full, textTransform: 'uppercase',
            }}>
              {meta.label}
            </span>
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted }}>
            {destination} · {formatDate(payout.createdAt)}
          </div>
          {payout.scheduledDate && payout.status !== 'paid' && (
            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
              Arrives {formatDate(payout.scheduledDate)}
            </div>
          )}
          {payout.failedReason && (
            <div style={{ fontSize: 11, color: colors.error, marginTop: 2 }}>{payout.failedReason}</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: payout.status === 'failed' ? colors.error : colors.navy }}>
            {formatCurrency(displayAmount)}
          </div>
          {payout.platformFee != null && payout.platformFee > 0 && (
            <div style={{ fontSize: 11, color: colors.textMuted }}>
              −{formatCurrency(payout.platformFee)} fee
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Service Breakdown ────────────────────────────────────────────────────────

const SERVICE_TYPE_META: Record<string, { label: string; icon: string; color: string }> = {
  rideshare: { label: 'Rideshare', icon: '🚗', color: '#2563EB' },
  delivery:  { label: 'Delivery',  icon: '📦', color: '#EA580C' },
  concierge: { label: 'Concierge', icon: '🎩', color: '#1a2744' },
};

function ServiceBreakdown({ rides }: { rides: RideEarning[] }) {
  const totals: Record<string, { earnings: number; count: number }> = {};
  for (const r of rides) {
    const key = r.serviceType ?? 'concierge';
    if (!totals[key]) totals[key] = { earnings: 0, count: 0 };
    totals[key]!.earnings += r.driverPayout + r.tip;
    totals[key]!.count += 1;
  }
  const entries = Object.entries(totals).sort((a, b) => b[1].earnings - a[1].earnings);
  if (entries.length <= 1) return null;

  return (
    <Card padding={14} style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        By Service Type
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map(([type, data]) => {
          const meta = SERVICE_TYPE_META[type] ?? SERVICE_TYPE_META['concierge']!;
          return (
            <div key={type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>{meta.icon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: meta.color }}>{meta.label}</span>
                <span style={{ fontSize: 11, color: colors.textMuted }}>{data.count} ride{data.count !== 1 ? 's' : ''}</span>
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: colors.navy }}>{formatCurrency(data.earnings)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Ride History Card ────────────────────────────────────────────────────────

function RideHistoryCard({ ride }: { ride: RideEarning }) {
  const total = ride.driverPayout + ride.tip;
  return (
    <Card padding={14}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>{getScenarioLabel(ride.scenario)}</div>
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
            {formatDate(ride.completedAt)} at {formatTime(ride.completedAt)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: colors.navy }}>{formatCurrency(total)}</div>
          {ride.tip > 0 && <div style={{ fontSize: 11, color: colors.success }}>+{formatCurrency(ride.tip)} tip</div>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: colors.textMuted, borderTop: `1px solid ${colors.borderLight}`, paddingTop: 8 }}>
        <span>📏 {formatDistance(ride.distanceMiles)}</span>
        {ride.rating !== undefined && <span>⭐ {ride.rating}/5</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11 }}>
          {ride.pickupAddress.split(',')[0]} → {ride.dropoffAddress.split(',')[0]}
        </span>
      </div>
    </Card>
  );
}
