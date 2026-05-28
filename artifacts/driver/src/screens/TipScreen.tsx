import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/services/supabase/client';
import { Button, Card, Spinner } from '@/components';
import { colors, borderRadius, withAlpha } from '@/theme';
import { formatCurrency, getScenarioLabel } from '@/utils/formatters';
import { apiUrl } from '@/services/api/baseUrl';
import type { RideRow, AssignmentRow } from '@/services/supabase/types';

// Presets in cents — matches TRANSPORT_RATES.tipPresets
const PRESET_CENTS = [300, 500, 1000, 1500];

interface RideSummary {
  scenario: string;
  actualFare: number;
  tandemRequired: boolean;
}

interface CoDriver {
  driverId: string;
  firstName: string;
  lastName: string;
  role: string;
}

export function TipScreen() {
  const navigate = useNavigate();
  const { rideId } = useParams<{ rideId: string }>();

  const [ride, setRide] = useState<RideSummary | null>(null);
  const [myDriverId, setMyDriverId] = useState<string | null>(null);
  const [coDriver, setCoDriver] = useState<CoDriver | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Solo tip state (also used as primary driver's tip in tandem)
  const [selectedCents, setSelectedCents] = useState<number | 'custom' | null>(null);
  const [customValue, setCustomValue] = useState('');

  // Tandem: independent co-driver tip
  const [splitEvenly, setSplitEvenly] = useState(false);
  const [coSelectedCents, setCoSelectedCents] = useState<number | 'custom' | null>(null);
  const [coCustomValue, setCoCustomValue] = useState('');

  // Co-driver tip share (primary sharing their own tip portion)
  const [showShareSection, setShowShareSection] = useState(false);
  const [sharePercent, setSharePercent] = useState(0);
  const [myEarningId, setMyEarningId] = useState<string | null>(null);

  // Inline share — set upfront before submission (the main path per spec)
  const [inlineShareEnabled, setInlineShareEnabled] = useState(false);
  const [inlineSharePercent, setInlineSharePercent] = useState(0);
  const [sharedInline, setSharedInline] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [tipSubmitted, setTipSubmitted] = useState(false);

  // ── Data load ──────────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!rideId) return;
    setLoading(true);
    try {
      const [rideRes, sessionRes] = await Promise.all([
        supabase
          .from('rides')
          .select('scenario, actual_fare, estimated_fare, tandem_required')
          .eq('id', rideId)
          .single(),
        supabase.auth.getSession(),
      ]);

      if (rideRes.error) throw rideRes.error;
      const row = rideRes.data as unknown as Pick<RideRow, 'scenario' | 'actual_fare' | 'estimated_fare' | 'tandem_required'>;
      setRide({
        scenario: row.scenario,
        actualFare: row.actual_fare ?? row.estimated_fare,
        tandemRequired: row.tandem_required ?? false,
      });

      const userId = sessionRes.data.session?.user?.id;
      if (!userId) return;

      // Resolve my driver ID
      const { data: driverRow } = await supabase
        .from('drivers')
        .select('id')
        .eq('profile_id', userId)
        .maybeSingle();
      const dId = (driverRow as { id: string } | null)?.id ?? null;
      setMyDriverId(dId);

      if (!dId) return;

      // Fetch assignments for this ride to find co-driver
      const { data: assignments } = await supabase
        .from('driver_assignments')
        .select('driver_id, role, status')
        .eq('ride_id', rideId);

      const typedAssignments = (assignments ?? []) as Array<Pick<AssignmentRow, 'driver_id' | 'role' | 'status'>>;
      const coAssignment = typedAssignments.find(a => a.driver_id !== dId);

      if (coAssignment) {
        const { data: coDriverRow } = await supabase
          .from('drivers')
          .select('id, first_name, last_name')
          .eq('id', coAssignment.driver_id)
          .maybeSingle();

        if (coDriverRow) {
          const cd = coDriverRow as { id: string; first_name: string; last_name: string };
          setCoDriver({ driverId: cd.id, firstName: cd.first_name, lastName: cd.last_name, role: coAssignment.role });
        }
      }

      // Check for existing tip earning (to show share section)
      const { data: existingEarning } = await supabase
        .from('driver_earnings')
        .select('id')
        .eq('driver_id', dId)
        .eq('job_id', rideId)
        .eq('kind', 'tip')
        .maybeSingle();

      if (existingEarning) {
        setMyEarningId((existingEarning as { id: string }).id);
        setTipSubmitted(true);
      }
    } catch {
      setLoadError("Couldn't load ride details.");
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function resolvePresetCents(
    sel: number | 'custom' | null,
    customStr: string,
  ): number | null {
    if (sel === 'custom') {
      const n = Math.round(parseFloat(customStr) * 100);
      return Number.isFinite(n) && n > 0 ? n : null;
    }
    return typeof sel === 'number' ? sel : null;
  }

  const myTipCents     = resolvePresetCents(selectedCents, customValue);
  const coTipCentsRaw  = resolvePresetCents(coSelectedCents, coCustomValue);
  const coTipCents     = splitEvenly ? myTipCents : coTipCentsRaw;
  const isTandem       = !!(ride?.tandemRequired && coDriver);

  // ── Submit tip(s) ──────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!myTipCents || !rideId) return;
    setSubmitError(null);
    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSubmitError('Session expired. Please sign in again.'); return; }

      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      };

      // Primary (or solo) driver tip — include inline sharePercent if set
      const shareToSend = inlineShareEnabled && inlineSharePercent >= 1 ? inlineSharePercent : undefined;
      const res = await fetch(apiUrl('/tips'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          rideId,
          amount: myTipCents / 100,
          ...(shareToSend !== undefined ? { sharePercent: shareToSend } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const tipResult = await res.json() as { earningId?: string; sharePercent?: number };
      if (tipResult.earningId) setMyEarningId(tipResult.earningId);
      if (tipResult.sharePercent && tipResult.sharePercent > 0) setSharedInline(true);

      // Co-driver tip (tandem only, independent amount)
      if (isTandem && coDriver && coTipCents && coTipCents > 0) {
        await fetch(apiUrl('/tips'), {
          method: 'POST',
          headers,
          body: JSON.stringify({ rideId, amount: coTipCents / 100, targetDriverId: coDriver.driverId }),
        });
      }

      setTipSubmitted(true);
      // If the driver set an inline share, skip the post-submit share screen
      if (shareToSend !== undefined && shareToSend > 0) {
        navigate('/home');
        return;
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Submit tip share ───────────────────────────────────────────────────────

  const handleTipShare = async () => {
    if (!myEarningId || sharePercent < 1 || !rideId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setSubmitError('Session expired.'); return; }

      const res = await fetch(apiUrl('/tips/share'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ rideId, earningId: myEarningId, sharePercent }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      navigate('/home');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading / submitted states ─────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner size={28} color={colors.gold} />
      </div>
    );
  }

  // ── After tip submitted — optionally share with co-driver ──────────────────

  if (tipSubmitted && myEarningId && isTandem && coDriver) {
    const shareCents = myTipCents ? Math.round(myTipCents * sharePercent / 100) : 0;

    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
        <div style={{
          background: colors.surfaceDark,
          padding: '40px 24px 28px',
          textAlign: 'center',
          borderRadius: `0 0 ${borderRadius.xl}px ${borderRadius.xl}px`,
        }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🤝</div>
          <h1 className="heading-editorial heading-editorial-lg on-dark" style={{ marginBottom: 4 }}>Tip Recorded!</h1>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
            Share a portion with your co-driver?
          </div>
        </div>

        <div style={{ padding: 20 }}>
          <Card padding={20} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
              {coDriver.firstName} {coDriver.lastName}
            </div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>Co-driver on this job</div>

            {showShareSection ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: colors.textSecondary }}>Share %</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: colors.gold }}>
                    {sharePercent}%{shareCents > 0 && ` (${formatCurrency(shareCents / 100)})`}
                  </span>
                </div>
                <input
                  type="range" min="0" max="50" step="5"
                  value={sharePercent}
                  onChange={e => setSharePercent(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: colors.gold, marginBottom: 16 }}
                />
                <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 16 }}>
                  You can share up to 50% of your tip. This is entirely optional.
                </div>
                {submitError && (
                  <div style={{ padding: '8px 12px', borderRadius: borderRadius.md, background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B', fontSize: 12, marginBottom: 12 }}>
                    {submitError}
                  </div>
                )}
                <Button
                  onClick={() => void handleTipShare()}
                  loading={submitting}
                  disabled={sharePercent < 1 || submitting}
                  fullWidth size="md" variant="primary"
                  style={{ marginBottom: 8 }}
                >
                  {sharePercent < 1 ? 'Move slider to share' : `Share ${formatCurrency(shareCents / 100)} with ${coDriver.firstName}`}
                </Button>
              </>
            ) : (
              <button
                onClick={() => setShowShareSection(true)}
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: borderRadius.md,
                  border: `1px solid ${colors.border}`, background: colors.bgSecondary,
                  color: colors.textSecondary, fontSize: 13, cursor: 'pointer',
                  fontFamily: 'inherit', textAlign: 'left',
                }}
              >
                Share a portion of my tip → (optional)
              </button>
            )}
          </Card>

          <Button onClick={() => navigate('/home')} variant="ghost" fullWidth size="lg">
            No Thanks — Back to Home
          </Button>
        </div>
      </div>
    );
  }

  // ── Post-submit, no co-driver to share with ────────────────────────────────

  if (tipSubmitted) {
    void navigate('/home');
    return null;
  }

  // ── Main tip screen ────────────────────────────────────────────────────────

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
        {/* ── Solo or Primary driver tip ── */}
        <Card style={{ marginBottom: 16 }} padding={20}>
          {isTandem && (
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              Your Tip
            </div>
          )}
          <TipPicker
            selectedCents={selectedCents}
            setSelectedCents={setSelectedCents}
            customValue={customValue}
            setCustomValue={setCustomValue}
          />
        </Card>

        {/* ── Tandem: inline share-from-own-tip section ── */}
        {isTandem && coDriver && (
          <Card style={{ marginBottom: 16 }} padding={20}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: inlineShareEnabled ? 14 : 0 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy }}>
                  Share with {coDriver.firstName}?
                </div>
                <div style={{ fontSize: 12, color: colors.textMuted }}>Optional — split your tip with your co-driver</div>
              </div>
              <button
                onClick={() => { setInlineShareEnabled((e) => !e); if (inlineShareEnabled) setInlineSharePercent(0); }}
                style={{
                  width: 40, height: 22, borderRadius: 11,
                  background: inlineShareEnabled ? colors.gold : colors.border,
                  border: 'none', cursor: 'pointer', position: 'relative',
                  transition: 'background 0.15s', flexShrink: 0,
                }}
                aria-checked={inlineShareEnabled}
                role="switch"
                aria-label="Share tip with co-driver"
              >
                <span style={{
                  position: 'absolute', top: 3,
                  left: inlineShareEnabled ? 'calc(100% - 19px)' : 3,
                  width: 16, height: 16, borderRadius: '50%',
                  background: '#fff', transition: 'left 0.15s',
                }} />
              </button>
            </div>

            {inlineShareEnabled && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: colors.textSecondary }}>Share</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: colors.gold }}>
                    {inlineSharePercent}%
                  </span>
                </div>
                <input
                  type="range" min="0" max="50" step="5"
                  value={inlineSharePercent}
                  onChange={(e) => setInlineSharePercent(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: colors.gold, marginBottom: 12 }}
                  aria-label={`Share ${inlineSharePercent}% with co-driver`}
                />
                <div style={{
                  padding: '10px 14px', borderRadius: borderRadius.md,
                  background: withAlpha(colors.gold, '08'),
                  border: `1px solid ${withAlpha(colors.gold, '25')}`,
                  fontSize: 13, color: colors.textSecondary, textAlign: 'center',
                }}>
                  {myTipCents && inlineSharePercent > 0 ? (
                    <>
                      You keep{' '}
                      <strong style={{ color: colors.navy }}>
                        {formatCurrency((myTipCents - Math.round(myTipCents * inlineSharePercent / 100)) / 100)}
                      </strong>
                      {' · '}
                      {coDriver.firstName} gets{' '}
                      <strong style={{ color: colors.navy }}>
                        {formatCurrency(Math.round(myTipCents * inlineSharePercent / 100) / 100)}
                      </strong>
                    </>
                  ) : myTipCents ? (
                    'Move slider to choose share amount'
                  ) : (
                    'Select a tip amount above first'
                  )}
                </div>
              </>
            )}
          </Card>
        )}

        {/* ── Tandem: co-driver tip section ── */}
        {isTandem && coDriver && (
          <Card style={{ marginBottom: 16 }} padding={20}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  {coDriver.firstName}'s Tip
                </div>
                <div style={{ fontSize: 12, color: colors.textMuted }}>{coDriver.firstName} {coDriver.lastName} · co-driver</div>
              </div>
              {/* Split evenly toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: colors.textMuted }}>Split evenly</span>
                <button
                  onClick={() => setSplitEvenly(s => !s)}
                  style={{
                    width: 36, height: 20, borderRadius: 10,
                    background: splitEvenly ? colors.gold : colors.border,
                    border: 'none', cursor: 'pointer', position: 'relative',
                    transition: 'background 0.15s', flexShrink: 0,
                  }}
                  aria-checked={splitEvenly}
                  role="switch"
                >
                  <span style={{
                    position: 'absolute', top: 2,
                    left: splitEvenly ? 'calc(100% - 18px)' : 2,
                    width: 16, height: 16, borderRadius: '50%',
                    background: '#fff', transition: 'left 0.15s',
                  }} />
                </button>
              </div>
            </div>

            {splitEvenly ? (
              <div style={{
                padding: '12px 14px', borderRadius: borderRadius.md,
                background: withAlpha(colors.gold, '08'), border: `1px solid ${withAlpha(colors.gold, '25')}`,
                fontSize: 14, color: colors.textSecondary, textAlign: 'center',
              }}>
                {myTipCents
                  ? `Co-driver will receive ${formatCurrency(myTipCents / 100)}`
                  : 'Select your tip amount above'}
              </div>
            ) : (
              <TipPicker
                selectedCents={coSelectedCents}
                setSelectedCents={setCoSelectedCents}
                customValue={coCustomValue}
                setCustomValue={setCoCustomValue}
              />
            )}
          </Card>
        )}

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
          disabled={!myTipCents || submitting}
          fullWidth size="lg"
          style={{ marginBottom: 12 }}
        >
          {myTipCents
            ? isTandem && coTipCents
              ? `Tip ${formatCurrency(myTipCents / 100)} + ${formatCurrency(coTipCents / 100)}`
              : `Tip ${formatCurrency(myTipCents / 100)}`
            : 'Select an amount'}
        </Button>

        {/* Skip */}
        <Button onClick={() => navigate('/home')} variant="ghost" fullWidth size="lg">
          No Tip — Back to Home
        </Button>
      </div>
    </div>
  );
}

// ── Reusable preset + custom picker ─────────────────────────────────────────

function TipPicker({
  selectedCents,
  setSelectedCents,
  customValue,
  setCustomValue,
}: {
  selectedCents: number | 'custom' | null;
  setSelectedCents: (v: number | 'custom') => void;
  customValue: string;
  setCustomValue: (v: string) => void;
}) {
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {PRESET_CENTS.map((c) => (
          <button
            key={c}
            onClick={() => setSelectedCents(c)}
            style={{
              flex: 1, padding: '12px 0',
              border: `2px solid ${selectedCents === c ? colors.gold : colors.border}`,
              borderRadius: borderRadius.md,
              background: selectedCents === c ? withAlpha(colors.gold, '08') : colors.bgSecondary,
              color: selectedCents === c ? colors.gold : colors.textPrimary,
              fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              minHeight: 52, transition: 'all 0.15s',
            }}
          >
            ${(c / 100).toFixed(0)}
          </button>
        ))}
      </div>
      <button
        onClick={() => setSelectedCents('custom')}
        style={{
          width: '100%', padding: '10px 14px',
          border: `2px solid ${selectedCents === 'custom' ? colors.gold : colors.border}`,
          borderRadius: borderRadius.md,
          background: selectedCents === 'custom' ? withAlpha(colors.gold, '08') : colors.bgSecondary,
          display: 'flex', alignItems: 'center', gap: 8,
          cursor: 'pointer', fontFamily: 'inherit', minHeight: 48,
        }}
      >
        <span style={{ fontSize: 13, color: colors.textMuted }}>Custom</span>
        <span style={{ color: colors.textMuted }}>$</span>
        <input
          type="number" inputMode="decimal" min="0.01" step="0.01"
          value={customValue}
          onClick={e => { e.stopPropagation(); setSelectedCents('custom'); }}
          onChange={e => { setCustomValue(e.target.value); setSelectedCents('custom'); }}
          placeholder="0.00"
          style={{
            flex: 1, border: 'none', background: 'transparent',
            fontSize: 15, fontWeight: 600, color: colors.textPrimary,
            outline: 'none', fontFamily: 'inherit',
          }}
        />
      </button>
    </>
  );
}
