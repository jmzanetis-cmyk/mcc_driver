import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/services/supabase/client';
import { Button, Card, InfoRow, Spinner } from '@/components';
import { OfflineNotice, isOffline } from '@/components/OfflineNotice';
import { colors, borderRadius } from '@/theme';
import {
  formatCurrency, formatDistance, formatDuration, getScenarioLabel, getTierLabel,
} from '@/utils/formatters';
import type { RideRow } from '@/services/supabase/types';
import { useAuth } from '@/hooks/useAuth';
import { apiUrl } from '@/services/api/baseUrl';

interface CompletedRideData {
  scenario: string;
  tier: string;
  pickupAddress: string;
  dropoffAddress: string;
  actualFare: number;
  driverPayout: number;
  distanceMiles: number;
  durationMinutes: number;
  tipAmount: number;
  tandemRequired: boolean;
}

export function RideCompleteScreen() {
  const navigate = useNavigate();
  const { rideId } = useParams<{ rideId: string }>();
  const { driver } = useAuth();
  const [ride, setRide] = useState<CompletedRideData | null>(null);
  const [rating, setRating] = useState(5);
  const [feedback, setFeedback] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fetchRide = useCallback(async () => {
    if (!rideId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [{ data: rideData, error: rideError }, { data: assignmentData }] = await Promise.all([
        supabase.from('rides').select('*').eq('id', rideId).single(),
        driver?.id
          ? supabase
              .from('driver_assignments')
              .select('driver_payout_amount')
              .eq('ride_id', rideId)
              .eq('driver_id', driver.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (rideError) throw rideError;
      if (!rideData) {
        setLoadError("We couldn't find that ride. It may have been removed.");
        return;
      }

      const row = rideData as unknown as RideRow;
      const started = row.started_at ? new Date(row.started_at).getTime() : 0;
      const completed = row.completed_at ? new Date(row.completed_at).getTime() : Date.now();
      const durationMs = completed - started;
      const fare = row.actual_fare ?? row.estimated_fare;
      const payout = (assignmentData as { driver_payout_amount: number | null } | null)?.driver_payout_amount ?? fare * 0.85;

      setRide({
        scenario: row.scenario,
        tier: row.tier,
        pickupAddress: row.pickup_address,
        dropoffAddress: row.dropoff_address,
        actualFare: fare,
        driverPayout: payout,
        distanceMiles: row.actual_distance_miles ?? row.estimated_distance_miles,
        durationMinutes: durationMs / 60000,
        tipAmount: row.tip_amount ?? 0,
        tandemRequired: (row as unknown as { tandem_required?: boolean }).tandem_required ?? false,
      });
    } catch (err) {
      setLoadError(
        isOffline()
          ? "You're offline — we'll load the summary as soon as you reconnect."
          : err instanceof Error
            ? err.message
            : "Couldn't load ride details. Tap retry.",
      );
    } finally {
      setLoading(false);
    }
  }, [rideId, driver?.id]);

  useEffect(() => {
    void fetchRide();
  }, [fetchRide]);

  const handleSubmitRating = async () => {
    if (!rideId) return;
    setSubmitError(null);
    if (isOffline()) {
      setSubmitError("You're offline — connect to submit your rating.");
      return;
    }
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Session expired');

      const res = await fetch(apiUrl('/ratings'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ rideId, stars: rating, comment: feedback || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      setSubmitted(true);
      navigate(ride?.tandemRequired ? `/ride/${rideId}/eval-codriver` : `/ride/${rideId}/tip`);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Couldn't submit rating. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !ride) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
        <Spinner size={28} color={colors.gold} />
        <div style={{ color: colors.textMuted, fontSize: 13 }}>Loading ride details…</div>
      </div>
    );
  }

  if (!ride) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: colors.bgPrimary }}>
        <Card padding={20} style={{ maxWidth: 340, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: colors.navy, marginBottom: 8 }}>
            Couldn't load ride
          </div>
          <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 16 }}>
            {loadError ?? 'Something went wrong.'}
          </div>
          <OfflineNotice style={{ marginBottom: 12 }} />
          <Button onClick={() => void fetchRide()} fullWidth>
            Retry
          </Button>
          <Button onClick={() => navigate('/home')} variant="ghost" fullWidth style={{ marginTop: 8 }}>
            Back to Home
          </Button>
        </Card>
      </div>
    );
  }

  const totalEarnings = ride.driverPayout + ride.tipAmount;

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <div style={{
        background: colors.surfaceDark, padding: '40px 24px 32px',
        textAlign: 'center',
        borderRadius: `0 0 ${borderRadius.xl}px ${borderRadius.xl}px`,
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: colors.success, margin: '0 auto 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28,
        }}>
          ✓
        </div>
        <h1 className="heading-editorial heading-editorial-lg on-dark" style={{ marginBottom: 4 }}>
          Ride Complete
        </h1>
        <div style={{ fontSize: 14, color: colors.gold }}>
          {getScenarioLabel(ride.scenario)}
        </div>
      </div>

      <div style={{ padding: 20 }}>
        <Card style={{ marginBottom: 16 }} padding={20}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Your Earnings
            </div>
            <div style={{ fontSize: 36, fontWeight: 700, color: colors.navy, marginTop: 4 }}>
              {formatCurrency(totalEarnings)}
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${colors.borderLight}`, paddingTop: 12 }}>
            <InfoRow icon="🧾" label="Ride fare" value={formatCurrency(ride.actualFare)} />
            <InfoRow icon="👨‍✈️" label="Your payout" value={formatCurrency(ride.driverPayout)} valueColor={colors.navy} />
            {ride.tipAmount > 0 && (
              <InfoRow icon="💝" label="Tip" value={formatCurrency(ride.tipAmount)} valueColor={colors.success} />
            )}
          </div>
        </Card>

        <Card style={{ marginBottom: 16 }} padding={14}>
          <InfoRow icon="📍" label="Pickup" value={ride.pickupAddress.split(',')[0]} />
          <InfoRow icon="🏁" label="Drop-off" value={ride.dropoffAddress.split(',')[0]} />
          <div style={{ borderTop: `1px solid ${colors.borderLight}`, marginTop: 4, paddingTop: 4 }} />
          <InfoRow icon="📏" label="Distance" value={formatDistance(ride.distanceMiles)} />
          <InfoRow icon="⏱️" label="Duration" value={formatDuration(ride.durationMinutes)} />
        </Card>

        {!submitted ? (
          <Card style={{ marginBottom: 16 }} padding={20}>
            <div style={{ fontSize: 16, fontWeight: 600, color: colors.navy, marginBottom: 4, textAlign: 'center' }}>
              Rate the Member
            </div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16, textAlign: 'center' }}>
              How was your experience?
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 36, color: star <= rating ? colors.gold : colors.border,
                    transition: 'color 0.15s, transform 0.1s',
                    transform: star <= rating ? 'scale(1.1)' : 'scale(1)',
                    minWidth: 48, minHeight: 48,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ★
                </button>
              ))}
            </div>

            <textarea
              value={feedback}
              onChange={e => setFeedback(e.target.value)}
              placeholder="Optional feedback (private)"
              rows={2}
              style={{
                width: '100%', padding: '10px 14px', fontSize: 14,
                border: `1px solid ${colors.border}`, borderRadius: borderRadius.sm,
                background: colors.bgSecondary, color: colors.textPrimary,
                resize: 'none', outline: 'none', fontFamily: 'inherit',
                marginBottom: 16,
              }}
            />

            <OfflineNotice style={{ marginBottom: 10 }} />
            {submitError && (
              <div style={{
                marginBottom: 10, padding: '10px 12px',
                background: '#FEF2F2', border: '1px solid #FCA5A5',
                color: '#991B1B', borderRadius: 8, fontSize: 12, fontWeight: 600,
              }}>
                {submitError}
              </div>
            )}
            <Button onClick={handleSubmitRating} loading={submitting} fullWidth>
              Submit Rating
            </Button>
          </Card>
        ) : (
          <Card style={{ marginBottom: 16, background: colors.successBg, border: 'none' }} padding={16}>
            <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, color: colors.success }}>
              ✓ Rating submitted — thank you!
            </div>
          </Card>
        )}

        <Button
          onClick={() => navigate(ride.tandemRequired ? `/ride/${rideId}/eval-codriver` : `/ride/${rideId}/tip`)}
          variant="secondary" fullWidth size="lg"
        >
          {ride.tandemRequired ? 'Rate Co-Driver →' : 'Leave a Tip'}
        </Button>
      </div>
    </div>
  );
}
