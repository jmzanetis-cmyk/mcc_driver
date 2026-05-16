// ============================================================
// MCC Driver — Ride-Along Driver Dashboard
// ============================================================
// Shown to ride-along (tandem) drivers once their profile is
// active + verified. Displays:
//   1. Live broadcast jobs (Supabase Realtime) the driver can accept
//   2. The currently matched/confirmed job (if any)
//   3. Earnings + rating summary
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/services/supabase/client';
import { Button, Card, Spinner, StatCard } from '@/components';
import { colors, borderRadius, withAlpha } from '@/theme';
import { formatCurrency } from '@/utils/formatters';
import { acceptTandemMatch, declineTandemMatch } from '@/services/api/edgeFunctions';
import { useTandemBroadcasts, type TandemBroadcastRow } from '@/hooks/useTandemBroadcasts';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface RideAlongProfile {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  verified: boolean;
  rating: number;
  totalJobs: number;
  earningsTotal?: number | null;
  earningsThisWeek?: number | null;
}

interface ActiveTandemJob {
  id: string;
  rideId: string;
  providerId: string;
  matchStatus: string;
  memberApproved: boolean | null;
  rideAlongFee: number | string | null;
  matchDeadline: string | null;
}

function formatFee(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? formatCurrency(n) : '—';
}

function formatRemaining(deadlineIso: string | null): string {
  if (!deadlineIso) return '';
  const ms = new Date(deadlineIso).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
}

export function RideAlongDashboardScreen() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<RideAlongProfile | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveTandemJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actingOn, setActingOn] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate('/signin'); return; }

    const res = await fetch(`${BASE}/api/ride-along-drivers/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (res.status === 404) { navigate('/ride-along-apply'); return; }
    if (!res.ok) {
      setError('Failed to load your profile.');
      setLoading(false);
      return;
    }

    const data = await res.json() as RideAlongProfile;
    if (data.status !== 'active' || !data.verified) {
      navigate('/ride-along-pending');
      return;
    }
    setProfile(data);
  }, [navigate]);

  const fetchActiveJob = useCallback(async (driverId: string) => {
    // Scope strictly to jobs matched to THIS ride-along driver. Phase 3b
    // does not yet enforce this server-side via RLS, so we filter explicitly
    // on matched_ride_along_driver_id to avoid leaking other drivers' jobs.
    const { data, error } = await supabase
      .from('tandem_jobs')
      .select('id, ride_id, provider_id, match_status, member_approved, ride_along_fee, match_deadline, matched_ride_along_driver_id')
      .eq('matched_ride_along_driver_id', driverId)
      .in('match_status', ['matched', 'member_pending', 'confirmed'])
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[dashboard] active job fetch failed', error);
      return;
    }

    const mine = (data ?? [])[0];
    if (!mine) { setActiveJob(null); return; }

    const row = mine as Record<string, unknown>;
    setActiveJob({
      id: String(row.id),
      rideId: String(row.ride_id ?? ''),
      providerId: String(row.provider_id ?? ''),
      matchStatus: String(row.match_status ?? ''),
      memberApproved: (row.member_approved as boolean | null) ?? null,
      rideAlongFee: (row.ride_along_fee as number | string | null) ?? null,
      matchDeadline: (row.match_deadline as string | null) ?? null,
    });
  }, []);

  useEffect(() => {
    void (async () => {
      await fetchProfile();
      setLoading(false);
    })();
  }, [fetchProfile]);

  // Active-job fetch depends on the loaded profile (we need the driver id
  // to scope the query). Re-runs whenever the profile id changes.
  useEffect(() => {
    if (!profile?.id) return;
    void fetchActiveJob(profile.id);
  }, [profile?.id, fetchActiveJob]);

  const isLiveEnabled = !!profile && profile.status === 'active' && profile.verified;
  const { broadcasts, isConnected, refresh } = useTandemBroadcasts(isLiveEnabled);

  const handleAccept = useCallback(async (job: TandemBroadcastRow) => {
    setActingOn(job.id);
    const res = await acceptTandemMatch(job.id);
    setActingOn(null);
    if (res.success) {
      const tasks: Promise<unknown>[] = [refresh()];
      if (profile?.id) tasks.push(fetchActiveJob(profile.id));
      await Promise.all(tasks);
    } else {
      setError(res.error ?? 'Failed to accept. Try another job.');
    }
  }, [refresh, fetchActiveJob, profile?.id]);

  const handleDecline = useCallback(async (job: TandemBroadcastRow) => {
    setActingOn(job.id);
    const res = await declineTandemMatch(job.id);
    setActingOn(null);
    if (res.success) {
      await refresh();
    } else {
      setError(res.error ?? 'Failed to decline.');
    }
  }, [refresh]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.bgPrimary }}>
        <Spinner size={28} color={colors.gold} />
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={{ minHeight: '100vh', padding: 24, background: colors.bgPrimary }}>
        <div style={{ color: colors.error, fontSize: 14 }}>{error || 'Profile unavailable.'}</div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      {/* Header */}
      <div style={{
        background: colors.surfaceDark, padding: '20px 20px 24px',
        borderRadius: `0 0 ${borderRadius.xl}px ${borderRadius.xl}px`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 14, color: colors.gold, marginBottom: 2 }}>
              Ride-Along Driver
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: colors.textWhite }}>
              {profile.firstName} {profile.lastName}
            </div>
          </div>
          <div style={{
            padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
            background: isConnected ? `${withAlpha(colors.success, '30')}` : 'rgba(255,255,255,0.12)',
            color: isConnected ? colors.success : 'rgba(255,255,255,0.7)',
          }}>
            {isConnected ? '● LIVE' : '○ CONNECTING'}
          </div>
        </div>
      </div>

      <div style={{ padding: 20 }}>
        {/* Earnings / rating */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            Your Stats
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <StatCard
              label="Rating"
              value={Number(profile.rating ?? 0).toFixed(1)}
              sublabel={`${profile.totalJobs ?? 0} jobs`}
              color={colors.gold}
            />
            <StatCard
              label="This Week"
              value={formatFee(profile.earningsThisWeek ?? 0)}
              sublabel="ride-along fees"
              color={colors.navy}
            />
            <StatCard
              label="All Time"
              value={formatFee(profile.earningsTotal ?? 0)}
            />
          </div>
        </div>

        {/* Recent rating history */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            Rating History
          </div>
          <Card padding={14}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, color: colors.gold }}>
                  ⭐ {Number(profile.rating ?? 0).toFixed(2)}
                </div>
                <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                  Across {profile.totalJobs ?? 0} completed jobs
                </div>
              </div>
              <div style={{
                padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                background: `${withAlpha(colors.success, '15')}`, color: colors.success,
              }}>
                MCC VERIFIED
              </div>
            </div>
            {(profile.totalJobs ?? 0) === 0 && (
              <div style={{
                marginTop: 10, padding: 10, borderRadius: borderRadius.md,
                background: colors.bgSecondary, fontSize: 12, color: colors.textMuted,
              }}>
                Your first rated job will appear here.
              </div>
            )}
          </Card>
        </div>

        {/* Active matched job */}
        {activeJob && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              Your Active Job
            </div>
            <Card padding={16} style={{ border: `1px solid ${colors.gold}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: colors.navy }}>
                  Ride #{activeJob.rideId.slice(0, 8)}
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
                  background: activeJob.matchStatus === 'confirmed' ? `${withAlpha(colors.success, '20')}` : `${withAlpha(colors.warning, '20')}`,
                  color: activeJob.matchStatus === 'confirmed' ? colors.success : colors.warning,
                }}>
                  {activeJob.matchStatus === 'confirmed'
                    ? 'CONFIRMED'
                    : activeJob.memberApproved === null
                      ? 'AWAITING MEMBER'
                      : 'MATCHED'}
                </div>
              </div>
              <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 12 }}>
                Fee: <strong style={{ color: colors.navy }}>{formatFee(activeJob.rideAlongFee)}</strong>
              </div>
              <Button onClick={() => navigate(`/ride/${activeJob.rideId}/navigate`)} size="sm" fullWidth>
                Open Ride
              </Button>
            </Card>
          </div>
        )}

        {/* Live broadcast jobs */}
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
          Available Jobs
        </div>

        {error && (
          <div style={{
            padding: 12, marginBottom: 12, borderRadius: borderRadius.md,
            background: colors.errorBg, color: colors.error, fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {broadcasts.length === 0 ? (
          <Card padding={20} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📡</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
              Waiting for jobs
            </div>
            <div style={{ fontSize: 12, color: colors.textMuted }}>
              New ride-along broadcasts appear here in real time.
            </div>
          </Card>
        ) : (
          broadcasts.map((job) => (
            <Card key={job.id} padding={14} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: colors.navy }}>
                    Ride #{job.rideId.slice(0, 8)}
                  </div>
                  <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                    Mode {job.tandemMode} • {formatRemaining(job.matchDeadline)}
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: colors.gold }}>
                  {formatFee(job.rideAlongFee)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  onClick={() => void handleAccept(job)}
                  loading={actingOn === job.id}
                  size="sm"
                  fullWidth
                >
                  Accept
                </Button>
                <Button
                  onClick={() => void handleDecline(job)}
                  variant="ghost"
                  size="sm"
                  disabled={actingOn === job.id}
                >
                  Pass
                </Button>
              </div>
            </Card>
          ))
        )}

        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center' }}>
          <Button onClick={() => void supabase.auth.signOut().then(() => navigate('/signin'))} variant="ghost" size="sm">
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}
