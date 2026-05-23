// ============================================================
// MCC Driver — Performance Screen
// ============================================================

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/services/supabase/client';
import { PageHeader, Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { apiUrl } from '@/services/api/baseUrl';
import { formatCurrency } from '@/utils/formatters';

interface DriverStats {
  acceptanceRate: number;
  completionRate: number;
  completionRate30d: number;
  onTimeRate: number;
  averageRating: number;
  avg30dRating: number | null;
  ratingTrend: Array<{ label: string; avg: number }>;
  totalRides: number;
  totalEarnings: number;
  last30dRides: number;
}

function RateBar({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: colors.navy }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{(value * 100).toFixed(0)}%</span>
      </div>
      <div style={{ height: 8, background: colors.bgSecondary, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${(value * 100).toFixed(0)}%`,
          background: color, borderRadius: 4, transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  );
}

export function PerformanceScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const [stats, setStats] = useState<DriverStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!driver) return;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(apiUrl('/drivers/stats'), {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          setStats(await res.json() as DriverStats);
        } else {
          setError('Failed to load stats');
        }
      } catch {
        setError('Network error');
      } finally {
        setLoading(false);
      }
    })();
  }, [driver?.id]);

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Performance" onBack={() => navigate('/settings')} />

      <div style={{ padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>
        ) : error ? (
          <Card padding={24}>
            <div style={{ textAlign: 'center', color: colors.textMuted }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
              <div>{error}</div>
            </div>
          </Card>
        ) : stats && (
          <>
            {/* Hero stats */}
            <div style={{
              background: colors.surfaceDark, borderRadius: borderRadius.lg,
              padding: 20, marginBottom: 16,
            }}>
              <span className="eyebrow on-dark" style={{ marginBottom: 8, display: 'block' }}>All Time</span>
              <div style={{ display: 'flex', gap: 0 }}>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: colors.gold }}>{stats.totalRides}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>Total Rides</div>
                </div>
                <div style={{ width: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>{stats.averageRating.toFixed(1)}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>Avg Rating</div>
                </div>
                <div style={{ width: 1, background: 'rgba(255,255,255,0.1)', margin: '4px 0' }} />
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>{formatCurrency(stats.totalEarnings)}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>Total Paid</div>
                </div>
              </div>
            </div>

            {/* Last 30 days */}
            <Card padding={16} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16 }}>
                Last 30 Days
              </div>
              <RateBar value={stats.completionRate30d} label="Completion Rate" color={colors.success} />
              <RateBar value={stats.acceptanceRate} label="Acceptance Rate" color={colors.info} />
              <RateBar value={stats.onTimeRate} label="On-Time Rate" color={colors.gold} />
              {stats.avg30dRating != null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: `1px solid ${colors.border}` }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: colors.navy }}>Avg Rating (30d)</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: colors.gold }}>
                    {'★'.repeat(Math.round(stats.avg30dRating))} {stats.avg30dRating.toFixed(1)}
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: `1px solid ${colors.border}`, marginTop: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: colors.navy }}>Rides Completed</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: colors.navy }}>{stats.last30dRides}</span>
              </div>
            </Card>

            {/* Rating trend */}
            {stats.ratingTrend.length > 1 && (
              <Card padding={16} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>
                  Rating Trend
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 60 }}>
                  {stats.ratingTrend.map(({ label, avg }) => {
                    const height = Math.max(8, ((avg - 1) / 4) * 60);
                    return (
                      <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <div style={{ fontSize: 9, color: colors.textMuted }}>{avg}</div>
                        <div style={{
                          width: '100%', height, borderRadius: 3,
                          background: avg >= 4.5 ? colors.success : avg >= 3.5 ? colors.gold : colors.error,
                        }} />
                        <div style={{ fontSize: 9, color: colors.textMuted, textAlign: 'center' }}>{label}</div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Lifetime rates */}
            <Card padding={16}>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16 }}>
                Lifetime Rates
              </div>
              <RateBar value={stats.completionRate} label="Completion Rate" color={colors.success} />
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
