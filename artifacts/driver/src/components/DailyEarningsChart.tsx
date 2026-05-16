// ============================================================
// MCC Driver — Daily Earnings Bar Chart
// ============================================================

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import type { RideEarning } from '@/hooks/useEarnings';
import { colors, borderRadius } from '@/theme';
import { formatCurrency } from '@/utils/formatters';

type Period = 'week' | 'all';

interface Props {
  rides: RideEarning[];
  period: Period;
}

interface DayBucket {
  label: string;
  fullLabel: string;
  total: number;
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function buildWeekBuckets(rides: RideEarning[]): DayBucket[] {
  const now = new Date();
  const weekStart = new Date(now.getTime() - now.getDay() * 86_400_000);
  weekStart.setHours(0, 0, 0, 0);

  const buckets: DayBucket[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart.getTime() + i * 86_400_000);
    return {
      label: DAY_SHORT[d.getDay()],
      fullLabel: d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
      total: 0,
    };
  });

  for (const ride of rides) {
    const d = new Date(ride.completedAt);
    const dayIdx = d.getDay();
    buckets[dayIdx].total += ride.driverPayout + ride.tip;
  }

  return buckets;
}

function buildAllTimeBuckets(rides: RideEarning[]): DayBucket[] {
  if (rides.length === 0) return [];

  const map = new Map<string, { label: string; fullLabel: string; total: number; ts: number }>();

  for (const ride of rides) {
    const d = new Date(ride.completedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entry = map.get(key);
    const amount = ride.driverPayout + ride.tip;
    if (entry) {
      entry.total += amount;
    } else {
      map.set(key, {
        label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        fullLabel: d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
        total: amount,
        ts: d.getTime(),
      });
    }
  }

  return Array.from(map.values())
    .sort((a, b) => a.ts - b.ts)
    .map(({ label, fullLabel, total }) => ({ label, fullLabel, total }));
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: DayBucket }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const { fullLabel, total } = payload[0].payload;
  return (
    <div style={{
      background: colors.navy,
      borderRadius: borderRadius.sm,
      padding: '8px 12px',
      fontSize: 12,
      color: colors.textWhite,
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    }}>
      <div style={{ color: colors.gold, fontWeight: 600, marginBottom: 2 }}>
        {fullLabel}
      </div>
      <div>{formatCurrency(total)}</div>
    </div>
  );
}

export function DailyEarningsChart({ rides, period }: Props) {
  const buckets = period === 'week' ? buildWeekBuckets(rides) : buildAllTimeBuckets(rides);

  if (buckets.length === 0 || buckets.every(b => b.total === 0)) return null;

  const maxTotal = Math.max(...buckets.map(b => b.total));

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 12, fontWeight: 600, color: colors.textMuted,
        textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12,
      }}>
        Daily Earnings
      </div>
      <div style={{
        background: colors.bgCard,
        borderRadius: borderRadius.lg,
        padding: '16px 8px 8px',
        boxShadow: '0 1px 3px rgba(11, 29, 58, 0.08)',
      }}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={buckets} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke={colors.borderLight} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: colors.textMuted, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis hide />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: colors.bgSecondary }}
            />
            <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={48}>
              {buckets.map((b, i) => (
                <Cell
                  key={i}
                  fill={b.total === maxTotal && b.total > 0 ? colors.gold : colors.navy}
                  fillOpacity={b.total === 0 ? 0.15 : b.total === maxTotal ? 1 : 0.55}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{
          textAlign: 'center', fontSize: 11, color: colors.textMuted, marginTop: 4,
        }}>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: colors.gold, marginRight: 4 }} />
          Best day
        </div>
      </div>
    </div>
  );
}
