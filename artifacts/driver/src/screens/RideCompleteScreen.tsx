// ============================================================
// MCC Driver — Ride Complete Screen
// ============================================================
// Shown after a ride is completed. Fare summary + rate member.
// ============================================================

import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/services/supabase/client';
import { Button, Card, InfoRow } from '@/components';
import { colors, borderRadius } from '@/theme';
import {
  formatCurrency, formatDistance, formatDuration, getScenarioLabel, getTierLabel,
} from '@/utils/formatters';

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
}

export function RideCompleteScreen() {
  const navigate = useNavigate();
  const { rideId } = useParams<{ rideId: string }>();
  const [ride, setRide] = useState<CompletedRideData | null>(null);
  const [rating, setRating] = useState(5);
  const [feedback, setFeedback] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!rideId) return;

    async function fetchRide() {
      const { data } = await supabase
        .from('rides')
        .select('*')
        .eq('id', rideId)
        .single() as any;

      if (data) {
        const started = data.started_at ? new Date(data.started_at).getTime() : 0;
        const completed = data.completed_at ? new Date(data.completed_at).getTime() : Date.now();
        const durationMs = completed - started;

        setRide({
          scenario: data.scenario,
          tier: data.tier,
          pickupAddress: data.pickup_address,
          dropoffAddress: data.dropoff_address,
          actualFare: data.actual_fare || data.estimated_fare,
          driverPayout: (data.actual_fare || data.estimated_fare) * 0.85,
          distanceMiles: data.actual_distance_miles || data.estimated_distance_miles,
          durationMinutes: durationMs / 60000,
          tipAmount: data.tip_amount || 0,
        });
      }
    }

    fetchRide();
  }, [rideId]);

  const handleSubmitRating = async () => {
    if (!rideId) return;

    await supabase.from('rides').update({
      driver_rating: rating,
      driver_feedback: feedback || null,
    }).eq('id', rideId);

    setSubmitted(true);
  };

  if (!ride) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: colors.textMuted }}>Loading ride details...</div>
      </div>
    );
  }

  const totalEarnings = ride.driverPayout + ride.tipAmount;

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      {/* Success header */}
      <div style={{
        background: colors.navy, padding: '40px 24px 32px',
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
        <div style={{ fontSize: 22, fontWeight: 700, color: colors.textWhite, marginBottom: 4 }}>
          Ride Complete!
        </div>
        <div style={{ fontSize: 14, color: colors.gold }}>
          {getScenarioLabel(ride.scenario)}
        </div>
      </div>

      <div style={{ padding: 20 }}>
        {/* Earnings summary */}
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
            <InfoRow icon="👨‍✈️" label="Your share (85%)" value={formatCurrency(ride.driverPayout)} valueColor={colors.navy} />
            {ride.tipAmount > 0 && (
              <InfoRow icon="💝" label="Tip" value={formatCurrency(ride.tipAmount)} valueColor={colors.success} />
            )}
          </div>
        </Card>

        {/* Trip details */}
        <Card style={{ marginBottom: 16 }} padding={14}>
          <InfoRow icon="📍" label="Pickup" value={ride.pickupAddress.split(',')[0]} />
          <InfoRow icon="🏁" label="Drop-off" value={ride.dropoffAddress.split(',')[0]} />
          <div style={{ borderTop: `1px solid ${colors.borderLight}`, marginTop: 4, paddingTop: 4 }} />
          <InfoRow icon="📏" label="Distance" value={formatDistance(ride.distanceMiles)} />
          <InfoRow icon="⏱️" label="Duration" value={formatDuration(ride.durationMinutes)} />
        </Card>

        {/* Rate member */}
        {!submitted ? (
          <Card style={{ marginBottom: 16 }} padding={20}>
            <div style={{ fontSize: 16, fontWeight: 600, color: colors.navy, marginBottom: 4, textAlign: 'center' }}>
              Rate the Member
            </div>
            <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 16, textAlign: 'center' }}>
              How was your experience?
            </div>

            {/* Star rating */}
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
                  }}
                >
                  ★
                </button>
              ))}
            </div>

            {/* Optional feedback */}
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

            <Button onClick={handleSubmitRating} fullWidth>
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

        {/* Return home */}
        <Button onClick={() => navigate('/home')} variant="secondary" fullWidth size="lg">
          Back to Home
        </Button>
      </div>
    </div>
  );
}
