import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/services/supabase/client';
import { Button, Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { formatCurrency, getScenarioLabel } from '@/utils/formatters';
import { apiUrl } from '@/services/api/baseUrl';
import type { RideRow } from '@/services/supabase/types';

const PRESET_AMOUNTS = [2, 5, 10];

interface RideSummary {
  scenario: string;
  actualFare: number;
}

export function TipScreen() {
  const navigate = useNavigate();
  const { rideId } = useParams<{ rideId: string }>();

  const [ride, setRide] = useState<RideSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [selected, setSelected] = useState<number | 'custom' | null>(null);
  const [customValue, setCustomValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchRide = useCallback(async () => {
    if (!rideId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('rides')
        .select('scenario, actual_fare, estimated_fare')
        .eq('id', rideId)
        .single();
      if (error) throw error;
      const row = data as unknown as Pick<RideRow, 'scenario' | 'actual_fare' | 'estimated_fare'>;
      setRide({
        scenario: row.scenario,
        actualFare: row.actual_fare ?? row.estimated_fare,
      });
    } catch {
      setLoadError("Couldn't load ride details.");
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => { void fetchRide(); }, [fetchRide]);

  const resolvedAmount = (): number | null => {
    if (selected === 'custom') {
      const n = parseFloat(customValue);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return typeof selected === 'number' ? selected : null;
  };

  const handleSubmit = async () => {
    const amount = resolvedAmount();
    if (!amount || !rideId) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setSubmitError('Session expired. Please sign in again.');
        return;
      }

      const res = await fetch(apiUrl('/tips'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ rideId, amount }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      navigate('/home');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner size={28} color={colors.gold} />
      </div>
    );
  }

  const amount = resolvedAmount();

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      {/* Header */}
      <div style={{
        background: colors.surfaceDark,
        padding: '40px 24px 28px',
        textAlign: 'center',
        borderRadius: `0 0 ${borderRadius.xl}px ${borderRadius.xl}px`,
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>💝</div>
        <h1 className="heading-editorial heading-editorial-lg on-dark" style={{ marginBottom: 4 }}>
          Leave a Tip?
        </h1>
        {ride && (
          <div style={{ fontSize: 13, color: colors.gold }}>
            {getScenarioLabel(ride.scenario)}
            {ride.actualFare > 0 && (
              <span style={{ color: 'rgba(255,255,255,0.45)', marginLeft: 6 }}>
                · {formatCurrency(ride.actualFare)} fare
              </span>
            )}
          </div>
        )}
        {loadError && (
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>{loadError}</div>
        )}
      </div>

      <div style={{ padding: 20 }}>
        {/* Preset tip amounts */}
        <Card style={{ marginBottom: 16 }} padding={20}>
          <div style={{ fontSize: 13, color: colors.textMuted, textAlign: 'center', marginBottom: 16 }}>
            Select a tip amount
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            {PRESET_AMOUNTS.map((amt) => (
              <button
                key={amt}
                onClick={() => setSelected(amt)}
                style={{
                  flex: 1, padding: '14px 0',
                  border: `2px solid ${selected === amt ? colors.gold : colors.border}`,
                  borderRadius: borderRadius.md,
                  background: selected === amt ? 'rgba(201,152,46,0.08)' : colors.bgSecondary,
                  color: selected === amt ? colors.gold : colors.textPrimary,
                  fontSize: 18, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit',
                  minHeight: 56,
                  transition: 'all 0.15s',
                }}
              >
                ${amt}
              </button>
            ))}
          </div>

          {/* Custom amount row */}
          <button
            onClick={() => setSelected('custom')}
            style={{
              width: '100%', padding: '12px 16px',
              border: `2px solid ${selected === 'custom' ? colors.gold : colors.border}`,
              borderRadius: borderRadius.md,
              background: selected === 'custom' ? 'rgba(201,152,46,0.08)' : colors.bgSecondary,
              display: 'flex', alignItems: 'center', gap: 10,
              cursor: 'pointer', fontFamily: 'inherit', marginBottom: 0,
              minHeight: 52,
            }}
          >
            <span style={{ fontSize: 14, color: colors.textMuted }}>Custom</span>
            <span style={{ color: colors.textMuted }}>$</span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={customValue}
              onClick={(e) => { e.stopPropagation(); setSelected('custom'); }}
              onChange={(e) => { setCustomValue(e.target.value); setSelected('custom'); }}
              placeholder="0.00"
              style={{
                flex: 1, border: 'none', background: 'transparent',
                fontSize: 16, fontWeight: 600, color: colors.textPrimary,
                outline: 'none', fontFamily: 'inherit',
              }}
            />
          </button>
        </Card>

        {/* Error */}
        {submitError && (
          <div style={{
            marginBottom: 16, padding: '10px 14px',
            background: '#FEF2F2', border: '1px solid #FCA5A5',
            borderRadius: 8, color: '#991B1B', fontSize: 13, fontWeight: 600,
          }}>
            {submitError}
          </div>
        )}

        {/* Submit */}
        <Button
          onClick={() => void handleSubmit()}
          loading={submitting}
          disabled={!amount || submitting}
          fullWidth
          size="lg"
          style={{ marginBottom: 12 }}
        >
          {amount ? `Tip ${formatCurrency(amount)}` : 'Select an amount'}
        </Button>

        {/* Skip */}
        <Button
          onClick={() => navigate('/home')}
          variant="ghost"
          fullWidth
          size="lg"
        >
          No Tip — Back to Home
        </Button>
      </div>
    </div>
  );
}
