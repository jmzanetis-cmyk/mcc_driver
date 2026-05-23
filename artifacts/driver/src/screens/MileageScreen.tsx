// ============================================================
// MCC Driver — Mileage Tracker Screen (Phase 2C)
// ============================================================
// Per-trip odometer entry with IRS standard mileage deduction
// calculation ($0.70/mile for 2026).
// ============================================================

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/services/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { apiUrl } from '@/services/api/baseUrl';
import { PageHeader, Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { formatCurrency, formatDate } from '@/utils/formatters';

const IRS_RATE = 0.70;

interface MileageLog {
  id: string;
  trip_date: string;
  start_odometer: number;
  end_odometer: number;
  miles: number;
  notes: string | null;
}

interface MileageSummary {
  totalMiles: number;
  irsRate: number;
  deductionDollars: number;
  year: number;
}

async function authFetch(path: string, options?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
      ...(options?.headers ?? {}),
    },
  });
}

export function MileageScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const queryClient = useQueryClient();

  const [tripDate, setTripDate] = useState(() => new Date().toISOString().split('T')[0]!);
  const [startOdometer, setStartOdometer] = useState('');
  const [endOdometer, setEndOdometer] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['mileage', driver?.id],
    queryFn: async () => {
      const res = await authFetch('/mileage');
      if (!res.ok) throw new Error('Failed to fetch mileage');
      return res.json() as Promise<{ logs: MileageLog[]; summary: MileageSummary }>;
    },
    enabled: !!driver?.id,
    staleTime: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: async (body: object) => {
      const res = await authFetch('/mileage', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? 'Failed to save');
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mileage'] });
      setStartOdometer('');
      setEndOdometer('');
      setNotes('');
      setFormError(null);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/mileage/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mileage'] }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const start = Number(startOdometer);
    const end = Number(endOdometer);
    if (!start || !end) { setFormError('Both odometer readings are required'); return; }
    if (end <= start) { setFormError('End odometer must be greater than start'); return; }
    addMutation.mutate({ tripDate, startOdometer: start, endOdometer: end, notes: notes || undefined });
  }

  const logs = data?.logs ?? [];
  const summary = data?.summary;

  // Running totals by period
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const weekStart = new Date(now.getTime() - now.getDay() * 86_400_000);
  weekStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const todayMiles = logs.filter(l => l.trip_date.startsWith(todayStr!)).reduce((s, l) => s + l.miles, 0);
  const weekMiles = logs.filter(l => new Date(l.trip_date) >= weekStart).reduce((s, l) => s + l.miles, 0);
  const monthMiles = logs.filter(l => new Date(l.trip_date) >= monthStart).reduce((s, l) => s + l.miles, 0);

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Mileage Tracker" onBack={() => navigate('/earnings')} />

      <div style={{ padding: 20 }}>

        {/* Summary hero */}
        <div style={{
          background: colors.surfaceDark, borderRadius: borderRadius.lg,
          padding: 20, marginBottom: 16, textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            {summary?.year ?? new Date().getFullYear()} Mileage Deduction
          </div>
          <div className="heading-editorial on-dark" style={{ fontSize: 'clamp(2rem, 8vw, 2.75rem)', margin: '4px 0' }}>
            {formatCurrency(summary?.deductionDollars ?? 0)}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
            {(summary?.totalMiles ?? 0).toFixed(1)} mi × ${IRS_RATE}/mi (IRS 2026)
          </div>
        </div>

        {/* Period stat row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Today', miles: todayMiles },
            { label: 'This Week', miles: weekMiles },
            { label: 'This Month', miles: monthMiles },
          ].map(({ label, miles }) => (
            <Card key={label} padding={12} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: colors.navy }}>{miles.toFixed(1)}</div>
              <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>mi {label}</div>
              <div style={{ fontSize: 10, color: colors.success, marginTop: 2 }}>{formatCurrency(miles * IRS_RATE)}</div>
            </Card>
          ))}
        </div>

        {/* Add trip form */}
        <Card padding={16} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>
            Log a Trip
          </div>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Date</label>
                <input
                  type="date"
                  value={tripDate}
                  onChange={e => setTripDate(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Start Odometer (mi)</label>
                  <input
                    type="number"
                    placeholder="e.g. 42150"
                    value={startOdometer}
                    onChange={e => setStartOdometer(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: colors.textMuted, display: 'block', marginBottom: 4 }}>End Odometer (mi)</label>
                  <input
                    type="number"
                    placeholder="e.g. 42207"
                    value={endOdometer}
                    onChange={e => setEndOdometer(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
              {startOdometer && endOdometer && Number(endOdometer) > Number(startOdometer) && (
                <div style={{ fontSize: 12, color: colors.success, fontWeight: 600 }}>
                  {(Number(endOdometer) - Number(startOdometer)).toFixed(1)} mi → {formatCurrency((Number(endOdometer) - Number(startOdometer)) * IRS_RATE)} deduction
                </div>
              )}
              <div>
                <label style={{ fontSize: 11, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Notes (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. airport run"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              {formError && (
                <div style={{ fontSize: 12, color: colors.error }}>{formError}</div>
              )}
              <button
                type="submit"
                disabled={addMutation.isPending}
                style={{
                  padding: '12px 0', background: colors.navy, color: colors.textWhite,
                  border: 'none', borderRadius: borderRadius.full, fontSize: 14,
                  fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  opacity: addMutation.isPending ? 0.6 : 1,
                }}
              >
                {addMutation.isPending ? 'Saving…' : 'Log Trip'}
              </button>
            </div>
          </form>
        </Card>

        {/* Trip log */}
        <div style={{ fontSize: 12, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
          Trip Log ({summary?.year})
        </div>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}><Spinner color={colors.textMuted} /></div>
        ) : logs.length === 0 ? (
          <Card padding={24}>
            <div style={{ textAlign: 'center', color: colors.textMuted }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🚗</div>
              <div style={{ fontSize: 14 }}>No trips logged yet. Start tracking to calculate your deduction.</div>
            </div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {logs.map(log => (
              <Card key={log.id} padding={14}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: colors.navy }}>
                      {log.miles.toFixed(1)} mi
                    </div>
                    <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                      {formatDate(log.trip_date)} · {log.start_odometer.toLocaleString()} → {log.end_odometer.toLocaleString()}
                    </div>
                    {log.notes && (
                      <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>{log.notes}</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: colors.success }}>
                      {formatCurrency(log.miles * IRS_RATE)}
                    </div>
                    <button
                      onClick={() => deleteMutation.mutate(log.id)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 11, color: colors.error, padding: 0,
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
