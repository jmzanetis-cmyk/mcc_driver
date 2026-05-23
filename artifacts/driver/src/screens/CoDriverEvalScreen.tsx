// ============================================================
// MCC Driver — Co-Driver Evaluation Screen
// ============================================================

import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/services/supabase/client';
import { PageHeader, Card, Button } from '@/components';
import { colors, borderRadius } from '@/theme';
import { apiUrl } from '@/services/api/baseUrl';

const CRITERIA: Array<{ key: string; label: string; description: string }> = [
  { key: 'communication', label: 'Communication', description: 'Responsive, clear, kept you informed' },
  { key: 'punctuality',   label: 'Punctuality',   description: 'Arrived on time, met agreed schedules' },
  { key: 'safety',        label: 'Safety',         description: 'Safe driving, proper vehicle handling' },
  { key: 'professionalism', label: 'Professionalism', description: 'Conduct, appearance, member interaction' },
];

function StarRow({ label, description, value, onChange }: {
  label: string;
  description: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>{label}</div>
        <div style={{ fontSize: 11, color: colors.textMuted }}>{value > 0 ? `${value}/5` : '—'}</div>
      </div>
      <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 8 }}>{description}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => onChange(star)}
            style={{
              minWidth: 48, minHeight: 48, flex: 1,
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 30, lineHeight: 1,
              color: star <= value ? colors.gold : colors.border,
              transition: 'color 0.12s, transform 0.1s',
              transform: star <= value ? 'scale(1.1)' : 'scale(1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

export function CoDriverEvalScreen() {
  const navigate = useNavigate();
  const { rideId } = useParams<{ rideId: string }>();
  const [ratings, setRatings] = useState({ communication: 0, punctuality: 0, safety: 0, professionalism: 0 });
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const allRated = Object.values(ratings).every((v) => v > 0);

  const handleSubmit = async () => {
    if (!allRated || !rideId) return;
    setError(null);
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(apiUrl('/evaluations/co-driver'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ rideId, ...ratings, comment: comment || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Failed (${res.status})`);
      }
      setDone(true);
      setTimeout(() => navigate(`/ride/${rideId}/tip`), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't submit — try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div style={{
        minHeight: '100vh', background: colors.bgPrimary,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 32,
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: colors.successBg, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 36, marginBottom: 16,
        }}>✓</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: colors.navy, marginBottom: 8, textAlign: 'center' }}>
          Evaluation Submitted
        </div>
        <div style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center' }}>
          Thank you for helping us maintain quality.
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Rate Your Co-Driver" onBack={() => navigate(`/ride/${rideId}/tip`)} />

      <div style={{ padding: 20 }}>
        <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20, lineHeight: 1.5 }}>
          Rate your tandem partner across four criteria. Your feedback is anonymous and helps maintain quality on the platform.
        </div>

        <Card padding={20} style={{ marginBottom: 16 }}>
          {CRITERIA.map((c) => (
            <StarRow
              key={c.key}
              label={c.label}
              description={c.description}
              value={ratings[c.key as keyof typeof ratings]}
              onChange={(v) => setRatings((prev) => ({ ...prev, [c.key]: v }))}
            />
          ))}

          <div style={{ borderTop: `1px solid ${colors.borderLight}`, paddingTop: 16, marginTop: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy, marginBottom: 8 }}>
              Additional comments (optional)
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Any specific feedback for your co-driver…"
              rows={3}
              style={{
                width: '100%', padding: '10px 14px', fontSize: 14,
                border: `1px solid ${colors.border}`, borderRadius: borderRadius.sm,
                background: colors.bgSecondary, color: colors.textPrimary,
                resize: 'none', outline: 'none', fontFamily: 'inherit',
              }}
            />
          </div>
        </Card>

        {error && (
          <div style={{
            marginBottom: 12, padding: '10px 12px',
            background: '#FEF2F2', border: '1px solid #FCA5A5',
            color: '#991B1B', borderRadius: 8, fontSize: 12, fontWeight: 600,
          }}>
            {error}
          </div>
        )}

        <Button
          onClick={() => void handleSubmit()}
          loading={submitting}
          disabled={!allRated}
          fullWidth
          size="lg"
        >
          Submit Evaluation
        </Button>

        <button
          onClick={() => navigate(`/ride/${rideId}/tip`)}
          style={{
            marginTop: 12, width: '100%', background: 'none', border: 'none',
            fontSize: 13, color: colors.textMuted, cursor: 'pointer', padding: '8px 0',
          }}
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
