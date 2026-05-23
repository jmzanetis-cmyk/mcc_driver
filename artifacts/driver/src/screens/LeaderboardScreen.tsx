// ============================================================
// MCC Driver — Leaderboard Screen (Phase 2D)
// ============================================================
// Weekly / monthly top drivers by earnings, rating, rides.
// The requesting driver's own rank is highlighted.
// ============================================================

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/services/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { apiUrl } from '@/services/api/baseUrl';
import { PageHeader, Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { formatCurrency } from '@/utils/formatters';

type Period = 'weekly' | 'monthly';
type Category = 'earnings' | 'rating' | 'rides';

interface LeaderboardEntry {
  rank: number;
  driverId: string;
  firstName: string;
  value: number;
  isYou: boolean;
}

interface CategoryData {
  board: LeaderboardEntry[];
  myRank: number | null;
  myValue: number;
}

interface LeaderboardData {
  period: Period;
  periodStart: string;
  earnings: CategoryData;
  rating: CategoryData;
  rides: CategoryData;
}

async function authFetch(path: string) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(apiUrl(path), {
    headers: { Authorization: `Bearer ${session?.access_token}` },
  });
}

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

function formatValue(category: Category, value: number): string {
  if (category === 'earnings') return formatCurrency(value);
  if (category === 'rating') return value.toFixed(2);
  return value.toString();
}

function LeaderRow({ entry, category }: { entry: LeaderboardEntry; category: Category }) {
  const medal = MEDAL[entry.rank];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', padding: '10px 12px',
      background: entry.isYou ? 'var(--accent-gold-soft, rgba(201,152,46,0.12))' : 'transparent',
      borderRadius: entry.isYou ? borderRadius.sm : 0,
      borderBottom: `1px solid ${colors.borderLight}`,
    }}>
      <div style={{ width: 28, fontSize: medal ? 16 : 13, fontWeight: 700, color: colors.textMuted, flexShrink: 0 }}>
        {medal ?? `#${entry.rank}`}
      </div>
      <div style={{ flex: 1, fontSize: 14, fontWeight: entry.isYou ? 700 : 500, color: colors.navy }}>
        {entry.firstName}{entry.isYou ? ' (You)' : ''}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: entry.isYou ? 'var(--accent-gold, #C9982E)' : colors.navy }}>
        {formatValue(category, entry.value)}
      </div>
    </div>
  );
}

function CategoryBoard({ data, category, label, icon }: {
  data: CategoryData; category: Category; label: string; icon: string;
}) {
  const notInTop10 = data.myRank !== null && !data.board.some(e => e.isYou);

  return (
    <Card padding={0} style={{ marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: colors.navy }}>{icon} {label}</div>
        {data.myRank && (
          <div style={{ fontSize: 11, color: colors.textMuted }}>Your rank: #{data.myRank}</div>
        )}
      </div>
      {data.board.length === 0 ? (
        <div style={{ padding: '20px 14px', textAlign: 'center', color: colors.textMuted, fontSize: 13 }}>
          No data yet for this period
        </div>
      ) : (
        <>
          {data.board.map(entry => (
            <LeaderRow key={entry.driverId} entry={entry} category={category} />
          ))}
          {notInTop10 && (
            <div style={{
              display: 'flex', alignItems: 'center', padding: '10px 12px',
              background: 'var(--accent-gold-soft, rgba(201,152,46,0.12))',
              borderTop: `2px dashed ${colors.borderLight}`,
            }}>
              <div style={{ width: 28, fontSize: 13, fontWeight: 700, color: colors.textMuted }}>
                #{data.myRank}
              </div>
              <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: colors.navy }}>You</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-gold, #C9982E)' }}>
                {formatValue(category, data.myValue)}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function LeaderboardScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const [period, setPeriod] = useState<Period>('weekly');
  const [category, setCategory] = useState<Category>('earnings');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['leaderboard', driver?.id, period],
    queryFn: async () => {
      const res = await authFetch(`/leaderboard?period=${period}`);
      if (!res.ok) throw new Error('Failed to fetch leaderboard');
      return res.json() as Promise<LeaderboardData>;
    },
    enabled: !!driver?.id,
    staleTime: 120_000,
  });

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Leaderboard" onBack={() => navigate('/home')} />

      <div style={{ padding: 20 }}>

        {/* Period toggle */}
        <div style={{
          display: 'flex', background: colors.bgSecondary,
          borderRadius: borderRadius.md, padding: 4, marginBottom: 16,
        }}>
          {(['weekly', 'monthly'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                flex: 1, padding: '10px 0', border: 'none', cursor: 'pointer',
                borderRadius: borderRadius.sm, fontSize: 13, fontWeight: 600,
                background: period === p ? colors.bgCard : 'transparent',
                color: period === p ? colors.navy : colors.textMuted,
                boxShadow: period === p ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.2s', fontFamily: 'inherit',
              }}
            >
              {p === 'weekly' ? 'This Week' : 'This Month'}
            </button>
          ))}
        </div>

        {/* Category tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {([
            { key: 'earnings', label: '💰 Earnings' },
            { key: 'rating', label: '⭐ Rating' },
            { key: 'rides', label: '🚗 Rides' },
          ] as { key: Category; label: string }[]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setCategory(key)}
              style={{
                flex: 1, padding: '9px 4px', border: 'none', borderRadius: borderRadius.full,
                fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                background: category === key ? colors.navy : colors.bgSecondary,
                color: category === key ? colors.textWhite : colors.textMuted,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {isLoading && (
          <div style={{ textAlign: 'center', padding: 48 }}><Spinner color={colors.textMuted} /></div>
        )}

        {isError && (
          <Card padding={24}>
            <div style={{ textAlign: 'center', color: colors.textMuted }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
              <div>Couldn't load leaderboard. Try again later.</div>
            </div>
          </Card>
        )}

        {data && (
          <>
            {category === 'earnings' && (
              <CategoryBoard data={data.earnings} category="earnings" label="Top Earners" icon="💰" />
            )}
            {category === 'rating' && (
              <CategoryBoard data={data.rating} category="rating" label="Highest Rated" icon="⭐" />
            )}
            {category === 'rides' && (
              <CategoryBoard data={data.rides} category="rides" label="Most Rides" icon="🚗" />
            )}

            <div style={{ fontSize: 11, color: colors.textMuted, textAlign: 'center', marginTop: 8 }}>
              {period === 'weekly' ? 'Resets every Sunday' : 'Resets every month'} · Rating requires 5+ rides
            </div>
          </>
        )}
      </div>
    </div>
  );
}
