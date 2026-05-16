// ============================================================
// MCC Driver — Member Approval Screen
// ============================================================
// Public screen reached via deep link (e.g. SMS/email in Phase 3c).
// Shows the two matched drivers side-by-side and lets the MCC
// member approve or decline the ride-along driver.
//
// Phase 3b note: this route is intentionally unauthenticated —
// the deep link itself is the credential. Phase 3c will replace
// this with signed token verification.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import {
  memberApproveTandemMatch,
  memberDeclineTandemMatch,
} from '@/services/api/edgeFunctions';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface DriverSummary {
  id: string;
  firstName: string;
  lastName: string;
  rating: number;
  totalJobs: number;
  profilePhotoPath: string | null;
}

interface TandemMatchDetail {
  id: string;
  rideId: string;
  matchStatus: string;
  memberApproved: boolean | null;
  rideAlongFee: number | string | null;
  primaryDriver: DriverSummary | null;
  rideAlongDriver: DriverSummary | null;
}

function DriverPhoto({ driver }: { driver: DriverSummary }) {
  const initials = `${driver.firstName[0] ?? ''}${driver.lastName[0] ?? ''}`;
  if (driver.profilePhotoPath) {
    return (
      <img
        src={driver.profilePhotoPath}
        alt={`${driver.firstName} ${driver.lastName}`}
        style={{
          width: 72, height: 72, borderRadius: '50%',
          margin: '0 auto 12px', objectFit: 'cover',
          display: 'block', background: colors.bgSecondary,
        }}
      />
    );
  }
  return (
    <div style={{
      width: 72, height: 72, borderRadius: '50%',
      margin: '0 auto 12px', background: colors.bgSecondary,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 24, fontWeight: 700, color: colors.navy,
    }}>
      {initials}
    </div>
  );
}

function DriverCard({
  title,
  driver,
  accent,
}: {
  title: string;
  driver: DriverSummary | null;
  accent: string;
}) {
  if (!driver) {
    return (
      <Card padding={16} style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, marginBottom: 6 }}>
          {title.toUpperCase()}
        </div>
        <div style={{ fontSize: 13, color: colors.textMuted }}>Not assigned yet</div>
      </Card>
    );
  }

  return (
    <Card padding={16} style={{ flex: 1, borderTop: `3px solid ${accent}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: accent, marginBottom: 10, letterSpacing: 0.5 }}>
        {title.toUpperCase()}
      </div>
      <DriverPhoto driver={driver} />
      <div style={{ fontSize: 16, fontWeight: 700, color: colors.navy, textAlign: 'center' }}>
        {driver.firstName} {driver.lastName.charAt(0)}.
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, color: colors.navy,
          background: colors.gold, padding: '2px 6px',
          borderRadius: borderRadius.full, letterSpacing: 0.5,
        }}>
          MCC VERIFIED
        </span>
      </div>
      <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 6 }}>
        ⭐ {Number(driver.rating ?? 0).toFixed(1)} · {driver.totalJobs ?? 0} jobs
      </div>
    </Card>
  );
}

export function MemberApprovalScreen() {
  const { tandemJobId } = useParams<{ tandemJobId: string }>();
  const navigate = useNavigate();
  const [match, setMatch] = useState<TandemMatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState<'approve' | 'decline' | null>(null);
  const [doneState, setDoneState] = useState<'approved' | 'declined' | null>(null);

  const load = useCallback(async () => {
    if (!tandemJobId) return;
    setLoading(true);
    try {
      const res = await fetch(`${BASE}/api/tandem-jobs/${tandemJobId}/match-detail`);
      if (!res.ok) {
        if (res.status === 404) setError('This match link is no longer valid.');
        else setError(`Failed to load match (HTTP ${res.status}).`);
        setLoading(false);
        return;
      }
      const data = await res.json() as TandemMatchDetail;
      setMatch(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [tandemJobId]);

  useEffect(() => { void load(); }, [load]);

  const handleApprove = useCallback(async () => {
    if (!tandemJobId) return;
    setSubmitting('approve');
    setError('');
    const res = await memberApproveTandemMatch(tandemJobId);
    setSubmitting(null);
    if (res.success) {
      setDoneState('approved');
    } else {
      setError(res.error ?? 'Failed to approve.');
    }
  }, [tandemJobId]);

  const handleDecline = useCallback(async () => {
    if (!tandemJobId) return;
    setSubmitting('decline');
    setError('');
    const res = await memberDeclineTandemMatch(tandemJobId);
    setSubmitting(null);
    if (res.success) {
      setDoneState('declined');
    } else {
      setError(res.error ?? 'Failed to decline.');
    }
  }, [tandemJobId]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.bgPrimary }}>
        <Spinner size={28} color={colors.gold} />
      </div>
    );
  }

  if (error && !match) {
    return (
      <div style={{ minHeight: '100vh', padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: colors.bgPrimary }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: colors.navy, marginBottom: 8 }}>Match unavailable</div>
        <div style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', maxWidth: 320 }}>{error}</div>
      </div>
    );
  }

  if (doneState) {
    return (
      <div style={{ minHeight: '100vh', padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: colors.bgPrimary }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>
          {doneState === 'approved' ? '✅' : '🔁'}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: colors.navy, marginBottom: 8, textAlign: 'center' }}>
          {doneState === 'approved' ? 'Match Approved' : 'Looking for a New Match'}
        </div>
        <div style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', maxWidth: 320, marginBottom: 24 }}>
          {doneState === 'approved'
            ? 'Your concierge team has been notified and your ride is confirmed.'
            : "We're broadcasting to other available ride-along drivers. You'll be notified when a new match is found."}
        </div>
        <Button onClick={() => navigate('/')} variant="ghost" size="sm">Close</Button>
      </div>
    );
  }

  const canAct = match?.matchStatus === 'matched' || match?.matchStatus === 'member_pending';

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <div style={{
        background: colors.surfaceDark, padding: '24px 20px 28px',
        borderRadius: `0 0 ${borderRadius.xl}px ${borderRadius.xl}px`,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 12, color: colors.gold, marginBottom: 6, letterSpacing: 1, fontWeight: 600 }}>
          MY CAR CONCIERGE
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: colors.textWhite, marginBottom: 6 }}>
          Approve Your Drivers
        </div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>
          Review your concierge driver and your ride-along driver below.
        </div>
      </div>

      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
          <DriverCard title="Concierge Driver" driver={match?.primaryDriver ?? null} accent={colors.navy} />
          <DriverCard title="Ride-Along Driver" driver={match?.rideAlongDriver ?? null} accent={colors.gold} />
        </div>

        {!canAct && match && (
          <div style={{
            padding: 12, marginBottom: 16, borderRadius: borderRadius.md,
            background: colors.bgSecondary, color: colors.textMuted,
            fontSize: 13, textAlign: 'center',
          }}>
            This match is currently <strong>{match.matchStatus}</strong> and cannot be changed.
          </div>
        )}

        {error && (
          <div style={{
            padding: 12, marginBottom: 16, borderRadius: borderRadius.md,
            background: colors.errorBg, color: colors.error, fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {canAct && (
          <>
            <Button
              onClick={() => void handleApprove()}
              loading={submitting === 'approve'}
              disabled={submitting !== null}
              fullWidth
            >
              Approve Match
            </Button>
            <div style={{ height: 12 }} />
            <Button
              onClick={() => void handleDecline()}
              loading={submitting === 'decline'}
              disabled={submitting !== null}
              variant="ghost"
              fullWidth
            >
              Request a Different Ride-Along Driver
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
