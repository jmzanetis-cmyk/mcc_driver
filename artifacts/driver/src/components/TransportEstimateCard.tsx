// TransportEstimateCard — fare estimator for MCC vehicle transport jobs.
// Calls GET /api/transport/estimate and renders a full breakdown with an
// optional provider-subsidy slider (useful for admin tools / quote screens).

import React, { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '@/services/api/baseUrl';
import { Card, Spinner } from '@/components';
import { colors, borderRadius, withAlpha } from '@/theme';

interface EstimateResult {
  miles: number;
  isTandem: boolean;
  subsidyPercent: number;
  tierLabel: string;
  baseFareCents: number;
  adjustedFareCents: number;
  totalCents: number;
  multiplierRate: number;
  multiplierLabel: string;
  driverCents: number;
  insuranceCents: number;
  platformCents: number;
  primaryDriverCents: number | null;
  chaseDriverCents: number | null;
  memberPaysCents: number;
  providerPaysCents: number;
  tipPresets: number[];
  tipWindowHours: number;
}

function cents(n: number): string {
  return `$${(n / 100).toFixed(2)}`;
}

interface Props {
  showSubsidySlider?: boolean;
}

export function TransportEstimateCard({ showSubsidySlider = false }: Props) {
  const [miles, setMiles] = useState('');
  const [isTandem, setIsTandem] = useState(false);
  const [subsidy, setSubsidy] = useState(0);
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEstimate = useCallback(async () => {
    const m = parseFloat(miles);
    if (!Number.isFinite(m) || m <= 0) {
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = apiUrl(
        `/transport/estimate?miles=${m}&tandem=${isTandem}&subsidy=${subsidy}`,
      );
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setResult(await res.json() as EstimateResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load estimate');
    } finally {
      setLoading(false);
    }
  }, [miles, isTandem, subsidy]);

  useEffect(() => {
    const id = setTimeout(() => { void fetchEstimate(); }, 400);
    return () => clearTimeout(id);
  }, [fetchEstimate]);

  return (
    <Card padding={20}>
      <div style={{ fontSize: 12, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>
        Transport Fare Estimator
      </div>

      {/* Distance input */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: colors.textMuted, display: 'block', marginBottom: 5 }}>
          Distance (miles)
        </label>
        <input
          type="number"
          inputMode="decimal"
          min="0.1"
          step="0.1"
          value={miles}
          onChange={e => setMiles(e.target.value)}
          placeholder="e.g. 12.5"
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '10px 14px', borderRadius: borderRadius.md,
            border: `1px solid ${colors.border}`,
            background: colors.bgSecondary, color: colors.textPrimary,
            fontSize: 16, fontFamily: 'inherit', outline: 'none',
          }}
        />
      </div>

      {/* Tandem toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button
          onClick={() => setIsTandem(t => !t)}
          style={{
            width: 40, height: 22, borderRadius: 11,
            background: isTandem ? colors.gold : colors.border,
            border: 'none', cursor: 'pointer', position: 'relative',
            transition: 'background 0.15s', flexShrink: 0,
          }}
          aria-checked={isTandem}
          role="switch"
          aria-label="Tandem job"
        >
          <span style={{
            position: 'absolute', top: 3,
            left: isTandem ? 'calc(100% - 19px)' : 3,
            width: 16, height: 16, borderRadius: '50%',
            background: '#fff', transition: 'left 0.15s',
          }} />
        </button>
        <span style={{ fontSize: 14, color: colors.textSecondary }}>
          Tandem job <span style={{ color: colors.textMuted, fontSize: 12 }}>(+50% surcharge)</span>
        </span>
      </div>

      {/* Provider subsidy slider (optional) */}
      {showSubsidySlider && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <label style={{ fontSize: 12, color: colors.textMuted }}>Provider Subsidy</label>
            <span style={{ fontSize: 12, fontWeight: 700, color: colors.gold }}>{subsidy}%</span>
          </div>
          <input
            type="range"
            min="0" max="100" step="5"
            value={subsidy}
            onChange={e => setSubsidy(parseInt(e.target.value))}
            style={{ width: '100%', accentColor: colors.gold }}
          />
        </div>
      )}

      {/* Loading / error */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
          <Spinner size={20} color={colors.gold} />
        </div>
      )}
      {error && !loading && (
        <div style={{ padding: '8px 12px', borderRadius: borderRadius.md, background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Breakdown */}
      {result && !loading && (
        <div style={{ marginTop: 8 }}>
          {/* Tier badge + total */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
              color: colors.gold, background: withAlpha(colors.gold, '12'),
              padding: '3px 10px', borderRadius: borderRadius.full,
            }}>
              {result.tierLabel}
            </span>
            <span style={{ fontSize: 22, fontWeight: 800, color: colors.navy }}>
              {cents(result.totalCents)}
            </span>
          </div>

          {/* Multiplier badges */}
          {result.multiplierRate > 1 && result.multiplierLabel && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {result.multiplierLabel.split(' + ').map((label) => (
                <span key={label} style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
                  color: colors.gold,
                  background: withAlpha(colors.gold, '15'),
                  border: `1px solid ${withAlpha(colors.gold, '30')}`,
                  padding: '2px 8px', borderRadius: borderRadius.full,
                }}>
                  {label} +{Math.round((result.multiplierRate - 1) * 100)}%
                </span>
              ))}
              {result.baseFareCents !== result.adjustedFareCents && (
                <span style={{ fontSize: 11, color: colors.textMuted, alignSelf: 'center' }}>
                  (base {cents(result.baseFareCents)})
                </span>
              )}
            </div>
          )}

          {/* Split rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {result.isTandem && result.primaryDriverCents != null ? (
              <>
                <BreakdownRow label="Primary Driver" value={cents(result.primaryDriverCents)} accent={colors.success} />
                <BreakdownRow label="Chase Driver" value={cents(result.chaseDriverCents!)} accent={colors.success} />
              </>
            ) : (
              <BreakdownRow label="Driver Payout" value={cents(result.driverCents)} accent={colors.success} />
            )}
            <BreakdownRow label="Insurance Reserve" value={cents(result.insuranceCents)} accent={colors.textMuted} />
            <BreakdownRow label="Platform Fee" value={cents(result.platformCents)} accent={colors.textMuted} />
          </div>

          {/* Member vs provider split (when subsidy > 0) */}
          {showSubsidySlider && result.subsidyPercent > 0 && (
            <div style={{
              marginTop: 12, padding: '10px 14px',
              borderRadius: borderRadius.md,
              background: withAlpha(colors.navy, '05'),
              border: `1px solid ${withAlpha(colors.navy, '12')}`,
            }}>
              <BreakdownRow label={`Member Pays (${100 - result.subsidyPercent}%)`} value={cents(result.memberPaysCents)} accent={colors.navy} />
              <BreakdownRow label={`Provider Covers (${result.subsidyPercent}%)`} value={cents(result.providerPaysCents)} accent={colors.gold} style={{ marginTop: 5 }} />
            </div>
          )}

          {/* Tip presets note */}
          <div style={{ marginTop: 12, fontSize: 11, color: colors.textMuted }}>
            Tip presets: {result.tipPresets.map(c => cents(c)).join(' · ')} · {result.tipWindowHours}h tip window
          </div>
        </div>
      )}
    </Card>
  );
}

function BreakdownRow({
  label, value, accent, style: extraStyle,
}: {
  label: string; value: string; accent: string; style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...extraStyle }}>
      <span style={{ fontSize: 13, color: colors.textSecondary }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>{value}</span>
    </div>
  );
}
