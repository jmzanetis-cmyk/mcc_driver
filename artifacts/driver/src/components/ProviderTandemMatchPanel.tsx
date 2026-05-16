// ============================================================
// MCC Driver — Provider Tandem Match Panel
// ============================================================
// Shown on NavigateScreen when the provider has chosen Mode B
// (Platform Match). Polls the tandem job state and renders
// either a "searching" placeholder or the TandemMatchCard with
// Accept / Request Rematch controls.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import { Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { TandemMatchCard } from '@/components/TandemMatchCard';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface MatchedDriverSummary {
  id: string;
  firstName: string;
  lastName: string;
  rating: number;
  totalJobs: number;
  profilePhotoPath: string | null;
}

interface MatchDetail {
  id: string;
  matchStatus: string;
  memberApproved: boolean | null;
  rideAlongFee: number | string | null;
  primaryDriver: MatchedDriverSummary | null;
  rideAlongDriver: MatchedDriverSummary | null;
}

export function ProviderTandemMatchPanel({ tandemJobId }: { tandemJobId: string }) {
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/tandem-jobs/${tandemJobId}/match-detail`);
      if (!res.ok) {
        setError(`Match unavailable (HTTP ${res.status})`);
        setLoading(false);
        return;
      }
      const data = await res.json() as MatchDetail;
      setDetail(data);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setLoading(false);
    }
  }, [tandemJobId]);

  useEffect(() => {
    void load();
    // Lightweight polling for state changes (broadcast → matched → confirmed).
    // Phase 3c can replace this with a Supabase Realtime subscription.
    const t = setInterval(() => { void load(); }, 8000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <Card padding={16} style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Spinner size={18} color={colors.gold} />
          <span style={{ fontSize: 13, color: colors.textMuted }}>Loading match…</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card padding={16} style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: colors.error }}>{error}</div>
      </Card>
    );
  }

  if (!detail) return null;

  // Broadcast (still searching) — show waiting state instead of match card.
  if (detail.matchStatus === 'broadcast' || detail.matchStatus === 'pending_match') {
    return (
      <Card padding={16} style={{
        marginBottom: 16,
        borderLeft: `3px solid ${colors.gold}`,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: colors.gold, letterSpacing: 0.5, marginBottom: 6 }}>
          FINDING A RIDE-ALONG DRIVER
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Spinner size={18} color={colors.gold} />
          <span style={{ fontSize: 13, color: colors.textSecondary }}>
            Broadcasting your job to eligible drivers nearby…
          </span>
        </div>
      </Card>
    );
  }

  // Expired / no match — surface to user without crashing.
  if (detail.matchStatus === 'expired' || detail.matchStatus === 'dispatch_failed') {
    return (
      <Card padding={16} style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 13, color: colors.error,
          padding: '8px 10px', borderRadius: borderRadius.sm, background: colors.errorBg,
        }}>
          No ride-along driver was found in time. Contact dispatch for next steps.
        </div>
      </Card>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <TandemMatchCard
        tandemJobId={detail.id}
        matchedDriver={detail.rideAlongDriver}
        matchStatus={detail.matchStatus}
        memberApproved={detail.memberApproved}
        onAccept={() => { /* No-op: member must approve. Accept here just acknowledges. */ }}
        onRematch={() => { void load(); }}
      />
    </div>
  );
}
