// ============================================================
// MCC Driver — Home Dashboard Screen
// ============================================================

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/services/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useDriverStatus } from '@/hooks/useDriverStatus';
import { useRideRequests } from '@/hooks/useRideRequests';
import { useEarnings } from '@/hooks/useEarnings';
import { useDispatchStore } from '@/store/dispatchStore';
import { useDriverStatusStore } from '@/store/driverStatusStore';
import { OnlineToggle, Card, StatCard, Button, Spinner, MapView } from '@/components';
import { colors, borderRadius } from '@/theme';
import { formatCurrency, getStarDisplay, formatDate, formatTime } from '@/utils/formatters';
import { RideRequestModal } from './RideRequestScreen';
import { RELOCATION_SCENARIOS } from './RelocationScreen';
import { useNotifications } from '@/hooks/useNotifications';
import { useDocumentCompliance } from '@/hooks/useDocumentCompliance';
import { apiUrl } from '@/services/api/baseUrl';

const PRE_LAUNCH = import.meta.env.VITE_PRE_LAUNCH_MODE === 'true';

export function HomeScreen() {
  const navigate = useNavigate();
  const { driver, signOut } = useAuth();
  const { isOnline, isToggling, toggleOnline, currentLat, currentLng } = useDriverStatus(driver?.id || null);
  const { incomingRequest, acceptRide, declineRide, dismissRequest } = useRideRequests(driver?.id || null, isOnline);
  const { summary, isLoading: earningsLoading, isError: earningsError, refreshEarnings } = useEarnings(driver?.id || null);

  const serverCancelled = useDispatchStore((s) => s.serverCancelled);
  const setServerCancelled = useDispatchStore((s) => s.setServerCancelled);
  const locationError = useDriverStatusStore((s) => s.locationError);
  const { unreadCount } = useNotifications();
  const compliance = useDocumentCompliance();

  const [activePromo, setActivePromo] = useState<{ title: string; current: number; target: number } | null>(null);
  // Dismissible founder-recruitment banner (shown to active drivers who aren't yet founders).
  // Dismiss key is user-scoped (E7 pattern): mcc_dismiss_founder_banner_{driverId}
  const [showFounderBanner, setShowFounderBanner] = useState(false);
  const [announcementsUnread, setAnnouncementsUnread] = useState(0);
  const [upcomingRide, setUpcomingRide] = useState<{ id: string; scheduledAt: string; pickup: string } | null>(null);
  const [scheduledJobCount, setScheduledJobCount] = useState(0);
  const [trainingBanner, setTrainingBanner] = useState<{ title: string; subtitle: string } | null>(null);
  const [pendingEvalRideId, setPendingEvalRideId] = useState<string | null>(null);
  useEffect(() => {
    if (!driver) return;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(apiUrl('/promotions'), {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          const j = await res.json() as { promotions: Array<{ status: string; title: string; current_count: number; target_count: number }> };
          const first = j.promotions.find((p) => p.status === 'active');
          if (first) setActivePromo({ title: first.title, current: first.current_count, target: first.target_count });
        }
      } catch { /* ignore */ }
    })();
  }, [driver?.id]);

  useEffect(() => {
    if (!driver) return;
    const dismissKey = `mcc_dismiss_founder_banner_${driver.id}`;
    try { if (localStorage.getItem(dismissKey)) return; } catch { /* ignore */ }
    void (async () => {
      try {
        const { data } = await supabase
          .from('member_founder_profiles')
          .select('id')
          .eq('user_id', driver.userId)
          .eq('status', 'active')
          .maybeSingle();
        if (!data) setShowFounderBanner(true);
      } catch { /* non-blocking */ }
    })();
  }, [driver?.id]);

  function dismissFounderBanner() {
    if (!driver) return;
    try { localStorage.setItem(`mcc_dismiss_founder_banner_${driver.id}`, '1'); } catch { /* ignore */ }
    setShowFounderBanner(false);
  }

  useEffect(() => {
    if (!driver) return;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(apiUrl('/schedule'), {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          const j = await res.json() as { schedule: Array<{ id: string; scheduled_at: string; status: string; rides: { pickup_address: string } | null }> };
          const first = j.schedule.find((s) => s.status === 'accepted' && s.rides);
          if (first?.rides) setUpcomingRide({ id: first.id, scheduledAt: first.scheduled_at, pickup: first.rides.pickup_address.split(',')[0] ?? '' });
        }
      } catch { /* ignore */ }
    })();
  }, [driver?.id]);

  useEffect(() => {
    if (!driver || currentLat == null || currentLng == null) return;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const params = new URLSearchParams({ lat: String(currentLat), lng: String(currentLng) });
        const res = await fetch(apiUrl(`/transport/scheduled-available?${params.toString()}`), {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          const j = await res.json() as { jobs: unknown[] };
          setScheduledJobCount(j.jobs?.length ?? 0);
        }
      } catch { /* ignore */ }
    })();
  }, [driver?.id, currentLat, currentLng]);

  useEffect(() => {
    if (!driver) return;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(apiUrl('/training/modules'), {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (!res.ok) return;
        type TM = { slug: string; isCertified: boolean; percentComplete: number; tier_required: number };
        const j = await res.json() as { modules: TM[] };
        const certSlugs = new Set(j.modules.filter((m) => m.isCertified).map((m) => m.slug));
        const PREREQ: Record<number, string> = { 1: 'platform-basics', 2: 'passenger-rides', 3: 'solo-vehicle-shuttle' };
        const unlocked = (m: TM) => m.tier_required === 0 || certSlugs.has(PREREQ[m.tier_required] ?? '');
        const inProgress = j.modules.find((m) => !m.isCertified && unlocked(m) && m.percentComplete > 0);
        const nextUp = j.modules.find((m) => !m.isCertified && unlocked(m));
        if (inProgress) {
          setTrainingBanner({ title: 'Training in progress', subtitle: `Continue: ${inProgress.percentComplete}% complete` });
        } else if (nextUp) {
          setTrainingBanner({ title: 'Training available', subtitle: `Start: ${nextUp.slug.replace(/-/g, ' ')}` });
        }
      } catch { /* ignore */ }
    })();
  }, [driver?.id]);

  useEffect(() => {
    if (!driver) return;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(apiUrl('/announcements'), {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          const j = await res.json() as { unreadCount: number };
          setAnnouncementsUnread(j.unreadCount ?? 0);
        }
      } catch { /* ignore */ }
    })();
  }, [driver?.id]);

  useEffect(() => {
    if (!driver) return;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(apiUrl('/evaluations/pending-codriver'), {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (!res.ok) return;
        const j = await res.json() as { rides: Array<{ id: string }> };
        if (j.rides.length > 0) setPendingEvalRideId(j.rides[0].id);
      } catch { /* ignore */ }
    })();
  }, [driver?.id]);

  // Gate the Ride-Along Dashboard entry by checking the caller's
  // ride_along_drivers profile. Only drivers with a record see the card.
  // We treat a network failure as "unknown" rather than "no profile" so
  // an offline launch doesn't hide the entry from drivers who DO have a
  // record — the card simply stays hidden until the lookup succeeds.
  const [pendingCustodyCount, setPendingCustodyCount] = useState(0);
  useEffect(() => {
    if (!driver) return;
    void (async () => {
      try {
        const { data } = await supabase
          .from('custody_handoffs')
          .select('id')
          .eq('receiving_party_id', driver.userId)
          .eq('status', 'awaiting_receiver');
        setPendingCustodyCount(data?.length ?? 0);
      } catch { /* non-blocking */ }
    })();
  }, [driver?.id]);

  const [hasRideAlongProfile, setHasRideAlongProfile] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        const base = import.meta.env.BASE_URL.replace(/\/$/, '');
        const res = await fetch(`${base}/api/ride-along-drivers/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!cancelled && res.ok) setHasRideAlongProfile(true);
      } catch {
        // Swallow — leave hasRideAlongProfile in its current state.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!driver) return null;

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      {/* Pre-launch banner */}
      {PRE_LAUNCH && (
        <div style={{
          background: 'rgba(201,168,76,0.12)',
          borderBottom: '1px solid rgba(201,168,76,0.25)',
          padding: '12px 20px',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <span aria-hidden="true" style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>🔒</span>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
            <strong style={{ color: colors.gold, fontWeight: 600 }}>MCC Driver is in pre-launch.</strong>{' '}
            You can explore the app and complete training. Active dispatch will begin once licensing is finalized.
            We'll notify you when you can start earning.
          </p>
        </div>
      )}

      {/* Founder recruitment banner — shown to active non-founder drivers until dismissed */}
      {showFounderBanner && (
        <div style={{
          background: 'rgba(201,162,39,0.10)',
          borderBottom: '1px solid rgba(201,162,39,0.28)',
          padding: '12px 16px 12px 20px',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1 }}>
            <span aria-hidden="true" style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>⭐</span>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.gold, lineHeight: 1.4, marginBottom: 2 }}>
                Earn 50% on every shop you refer — for 12 months.
              </p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Join the Driver Founder program. Refer auto-service providers and earn half their bid-credit spend for 12 months from enrollment.{' '}
                <button
                  onClick={() => navigate('/founder')}
                  style={{ background: 'none', border: 'none', padding: 0, color: colors.gold, fontWeight: 600, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Learn more →
                </button>
              </p>
            </div>
          </div>
          <button
            onClick={dismissFounderBanner}
            aria-label="Dismiss founder banner"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1, flexShrink: 0, padding: '2px 4px' }}
          >
            ×
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{
        background: colors.surfaceDark, padding: '20px 20px 24px',
        borderRadius: `0 0 ${borderRadius.xl}px ${borderRadius.xl}px`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <span className="eyebrow on-dark" style={{ marginBottom: 6 }}>
              Welcome back
            </span>
            <h1 className="heading-editorial heading-editorial-lg on-dark" style={{ marginTop: 4 }}>
              {driver.firstName} {driver.lastName}
            </h1>
            {!earningsLoading && summary.averageRating > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                <span style={{ color: colors.gold, fontSize: 13 }}>★</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>
                  {summary.averageRating.toFixed(1)}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Bell icon with unread badge */}
            <button
              type="button"
              onClick={() => navigate('/notifications')}
              aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
              style={{
                width: 44, height: 44, borderRadius: '50%',
                background: 'rgba(255,255,255,0.08)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', border: 'none', padding: 0,
                position: 'relative',
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 18 }}>🔔</span>
              {unreadCount > 0 && (
                <div style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 16, height: 16, borderRadius: '50%',
                  background: colors.error, color: '#fff',
                  fontSize: 9, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: `2px solid ${colors.surfaceDark}`,
                }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </div>
              )}
            </button>
            <button
              type="button"
              onClick={() => navigate('/settings')}
              aria-label={`Open settings for ${driver.firstName} ${driver.lastName}`}
              style={{
                width: 44, height: 44, borderRadius: '50%',
                background: 'rgba(201,152,46,0.15)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, color: colors.gold,
                cursor: 'pointer', border: 'none', padding: 0,
                fontFamily: 'inherit',
              }}
            >
              <span aria-hidden="true">{driver.firstName[0]}{driver.lastName[0]}</span>
            </button>
          </div>
        </div>

        {/* Online toggle */}
        <OnlineToggle
          isOnline={isOnline}
          isToggling={isToggling}
          onToggle={toggleOnline}
          disabledReason={
            PRE_LAUNCH
              ? 'Coming soon — licensing in progress'
              : driver.bgcStatus !== 'passed'
              ? 'Background check required'
              : undefined
          }
        />
      </div>

      {/* Live location map — 40% viewport height */}
      <MapView
        center={currentLat != null && currentLng != null ? { lat: currentLat, lng: currentLng } : null}
        driverPosition={isOnline && currentLat != null && currentLng != null ? { lat: currentLat, lng: currentLng } : null}
        zoom={15}
        style={{ height: '40vh' }}
      />

      <div style={{ padding: 20 }}>
        {/* Pending custody handoffs alert */}
        {pendingCustodyCount > 0 && (
          <Card
            onClick={() => navigate('/custody')}
            padding={14}
            style={{
              marginBottom: 16, cursor: 'pointer',
              border: `1px solid rgba(59,130,246,0.4)`,
              background: 'rgba(59,130,246,0.06)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>🔑</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1d4ed8' }}>
                  {pendingCustodyCount} custody handoff{pendingCustodyCount > 1 ? 's' : ''} awaiting you
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                  Tap to review and accept
                </div>
              </div>
              <span style={{ color: colors.textMuted, fontSize: 16 }}>›</span>
            </div>
          </Card>
        )}

        {/* Location permission error banner */}
        {locationError && (
          <Card
            padding={14}
            style={{
              marginBottom: 16, cursor: 'pointer',
              border: `1px solid ${colors.error}`,
              background: colors.errorBg,
            }}
            onClick={() => {
              // On Capacitor/iOS we can deep-link to app settings; web falls
              // back to re-prompting via getCurrentPosition.
              const opened = window.open('app-settings:', '_system');
              if (!opened) navigator.geolocation?.getCurrentPosition(() => {}, () => {});
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>📍</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.error }}>
                  Location access required to go online
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                  Tap to open Settings and enable location
                </div>
              </div>
              <span style={{ color: colors.error, fontSize: 16 }}>›</span>
            </div>
          </Card>
        )}

        {/* Document compliance banner */}
        {!compliance.isLoading && (compliance.isBlocked || compliance.hasWarnings) && (
          <Card
            onClick={() => navigate('/documents')}
            padding={14}
            style={{
              marginBottom: 16, cursor: 'pointer',
              border: `1px solid ${compliance.isBlocked ? colors.error : colors.warning}`,
              background: compliance.isBlocked ? colors.errorBg : colors.warningBg,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>{compliance.isBlocked ? '🚫' : '⚠️'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: compliance.isBlocked ? colors.error : colors.warning }}>
                  {compliance.isBlocked ? 'Document Expired — Cannot Go Online' : 'Document Expiring Soon'}
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                  Tap to review your documents
                </div>
              </div>
              <span style={{ color: colors.textMuted }}>›</span>
            </div>
          </Card>
        )}

        {/* BGC status card — hidden once passed */}
        {driver.bgcStatus !== 'passed' && (
          <Card
            onClick={() => navigate(driver.bgcStatus === 'failed' ? '/support' : '/profile')}
            padding={14}
            style={{
              marginBottom: 16, cursor: 'pointer',
              border: `1px solid ${driver.bgcStatus === 'pending' ? colors.warning : colors.error}`,
              background: driver.bgcStatus === 'pending' ? colors.warningBg : colors.errorBg,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>
                {driver.bgcStatus === 'pending' ? '🕐' : '🛡️'}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: 13, fontWeight: 700,
                  color: driver.bgcStatus === 'pending' ? colors.warning : colors.error,
                }}>
                  {driver.bgcStatus === 'pending'
                    ? 'Background check in progress'
                    : driver.bgcStatus === 'failed'
                    ? 'Background check failed — contact support'
                    : 'Background check required'}
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                  {driver.bgcStatus === 'pending'
                    ? 'You\'ll be notified when it\'s complete'
                    : driver.bgcStatus === 'failed'
                    ? 'Tap to reach support'
                    : 'Complete your background check to go online'}
                </div>
              </div>
              <span style={{ color: colors.textMuted }}>›</span>
            </div>
          </Card>
        )}

        {/* Training banner */}
        {trainingBanner && (
          <Card
            onClick={() => navigate('/training')}
            padding={14}
            style={{
              marginBottom: 16, cursor: 'pointer',
              border: `1px solid ${colors.gold}`,
              background: `rgba(201,152,46,0.06)`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>🎓</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.navy }}>{trainingBanner.title}</div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{trainingBanner.subtitle}</div>
              </div>
              <span style={{ color: colors.gold }}>›</span>
            </div>
          </Card>
        )}

        {/* Announcements unread banner */}
        {announcementsUnread > 0 && (
          <Card
            onClick={() => navigate('/announcements')}
            padding={14}
            style={{
              marginBottom: 16, cursor: 'pointer',
              border: `1px solid ${colors.navy}`,
              background: 'rgba(27,42,74,0.06)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>📢</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.navy }}>
                  {announcementsUnread === 1 ? '1 new announcement' : `${announcementsUnread} new announcements`}
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                  Tap to read platform updates
                </div>
              </div>
              <div style={{
                minWidth: 22, height: 22, borderRadius: 11,
                background: colors.navy, color: '#fff',
                fontSize: 11, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {announcementsUnread > 9 ? '9+' : announcementsUnread}
              </div>
            </div>
          </Card>
        )}

        {/* Pending co-driver evaluation banner */}
        {pendingEvalRideId && (
          <Card
            onClick={() => navigate(`/ride/${pendingEvalRideId}/eval-codriver`)}
            padding={14}
            style={{
              marginBottom: 16, cursor: 'pointer',
              border: `1px solid ${colors.info}`,
              background: `rgba(59,130,246,0.06)`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>🤝</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.navy }}>Rate your co-driver</div>
                <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                  You have a tandem job evaluation waiting
                </div>
              </div>
              <span style={{ color: colors.textMuted }}>›</span>
            </div>
          </Card>
        )}

        {earningsError && (
          <Card padding={14} style={{ marginBottom: 16, border: `1px solid ${colors.error}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontSize: 13, color: colors.error, fontWeight: 600 }}>
                Couldn't refresh today's earnings.
              </div>
              <button
                onClick={() => { void refreshEarnings(); }}
                style={{
                  padding: '6px 12px', background: colors.navy, color: colors.textWhite,
                  border: 'none', borderRadius: borderRadius.full,
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          </Card>
        )}
        {earningsLoading && !earningsError && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 8, marginBottom: 4 }}>
            <Spinner size={16} color={colors.textMuted} />
          </div>
        )}
        {/* Today's earnings */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            Today
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <StatCard label="Earned" value={formatCurrency(summary.today)} sublabel={`${summary.ridesToday} ride${summary.ridesToday !== 1 ? 's' : ''}`} color={colors.navy} />
            <StatCard label="Rating" value={summary.averageRating.toFixed(1)} sublabel={getStarDisplay(summary.averageRating)} color={colors.gold} />
          </div>
        </div>

        {/* This week */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            This Week
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <StatCard label="Earned" value={formatCurrency(summary.thisWeek)} sublabel={`${summary.ridesThisWeek} rides`} />
            <StatCard label="All Time" value={formatCurrency(summary.allTime)} sublabel={`${summary.ridesAllTime} rides`} />
          </div>
        </div>

        {/* Performance summary */}
        {!earningsLoading && (
          <Card
            onClick={() => navigate('/performance')}
            style={{ marginBottom: 20, cursor: 'pointer' }}
            padding={14}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Performance
              </div>
              <span style={{ fontSize: 12, color: colors.gold, fontWeight: 600 }}>View Details ›</span>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <StatCard label="Completion" value={`${((driver?.completionRate ?? 1) * 100).toFixed(0)}%`} />
              <StatCard label="Rating" value={summary.averageRating.toFixed(1)} sublabel={'★'.repeat(Math.round(summary.averageRating))} color={colors.gold} />
            </div>
          </Card>
        )}

        {/* Quick actions */}
        <div style={{ display: 'flex', gap: 10 }}>
          <Card onClick={() => navigate('/earnings')} style={{ flex: 1, cursor: 'pointer' }} padding={14}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>💰</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy }}>Earnings</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>View details</div>
          </Card>
          <Card onClick={() => navigate('/training')} style={{ flex: 1, cursor: 'pointer' }} padding={14}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>🎓</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy }}>Training</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>Certifications</div>
          </Card>
          <Card onClick={() => navigate('/settings')} style={{ flex: 1, cursor: 'pointer' }} padding={14}>
            <div style={{ fontSize: 20, marginBottom: 6 }}>⚙️</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy }}>Settings</div>
            <div style={{ fontSize: 11, color: colors.textMuted }}>Profile & prefs</div>
          </Card>
        </div>

        {/* Ride-Along Driver Dashboard entry — visible only to drivers
            with an existing ride_along_drivers record. */}
        {hasRideAlongProfile && (
          <Card
            onClick={() => navigate('/ride-along')}
            style={{ marginTop: 12, cursor: 'pointer', border: `1px solid ${colors.gold}` }}
            padding={14}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 24 }}>🚖</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>Ride-Along Jobs</div>
                <div style={{ fontSize: 12, color: colors.textMuted }}>Tandem dashboard — live broadcasts & matches</div>
              </div>
              <div style={{ fontSize: 18, color: colors.gold }}>→</div>
            </div>
          </Card>
        )}

        {/* Browse Scheduled Jobs */}
        <Card
          onClick={() => navigate('/scheduled-jobs')}
          style={{ marginTop: 12, cursor: 'pointer', border: `1px solid ${colors.gold}` }}
          padding={14}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 24 }}>🗓️</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>Browse Scheduled Jobs</div>
              <div style={{ fontSize: 12, color: colors.textMuted }}>
                {scheduledJobCount > 0
                  ? `${scheduledJobCount} job${scheduledJobCount !== 1 ? 's' : ''} available near you`
                  : 'Find upcoming scheduled rides on the map'}
              </div>
            </div>
            {scheduledJobCount > 0 && (
              <div style={{
                minWidth: 24, height: 24, borderRadius: 12, padding: '0 6px',
                background: colors.gold, color: colors.navy,
                fontSize: 12, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {scheduledJobCount > 99 ? '99+' : scheduledJobCount}
              </div>
            )}
            <div style={{ fontSize: 18, color: colors.gold }}>→</div>
          </div>
        </Card>

        {/* Upcoming scheduled ride */}
        {upcomingRide && (
          <Card
            onClick={() => navigate('/schedule')}
            style={{ marginBottom: 12, cursor: 'pointer', border: `1px solid ${colors.info}` }}
            padding={14}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>📅</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.navy }}>
                  Upcoming: {formatDate(upcomingRide.scheduledAt)} at {formatTime(upcomingRide.scheduledAt)}
                </div>
                <div style={{ fontSize: 11, color: colors.textMuted }}>
                  Pickup: {upcomingRide.pickup}
                </div>
              </div>
              <span style={{ color: colors.textMuted }}>›</span>
            </div>
          </Card>
        )}

        {/* Active promotion progress */}
        {activePromo && (
          <Card
            onClick={() => navigate('/promotions')}
            style={{ marginTop: 12, cursor: 'pointer', border: `1px solid ${colors.gold}` }}
            padding={14}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 18 }}>🎯</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: colors.navy }}>{activePromo.title}</div>
                <div style={{ fontSize: 11, color: colors.textMuted }}>
                  {activePromo.current} / {activePromo.target} rides
                </div>
              </div>
              <span style={{ fontSize: 12, color: colors.gold, fontWeight: 600 }}>
                {Math.round((activePromo.current / activePromo.target) * 100)}%
              </span>
            </div>
            <div style={{ height: 6, background: colors.bgSecondary, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.round(Math.min(1, activePromo.current / activePromo.target) * 100)}%`,
                background: colors.gold, borderRadius: 3,
              }} />
            </div>
          </Card>
        )}

        {/* AI Support button */}
        <Card onClick={() => navigate('/support')} style={{ marginTop: 12, cursor: 'pointer', border: `1px solid ${colors.gold}` }} padding={14}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 24 }}>🤖</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>AI Support</div>
              <div style={{ fontSize: 12, color: colors.textMuted }}>Earnings, vehicles, payouts, help & more</div>
            </div>
            <div style={{ fontSize: 18, color: colors.gold }}>→</div>
          </div>
        </Card>

        {/* Status indicator */}
        {isOnline && (
          <div style={{
            marginTop: 20, padding: 16, background: colors.successBg,
            borderRadius: borderRadius.md, textAlign: 'center',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: colors.success }}>
              🟢 You're online and accepting rides
            </div>
            <div style={{ fontSize: 12, color: colors.success, marginTop: 4 }}>
              Your next ride will appear here as soon as one is dispatched.
            </div>
          </div>
        )}
      </div>

      {/* Incoming ride request modal */}
      {incomingRequest && (
        <RideRequestModal
          request={incomingRequest}
          onAccept={async () => {
            const result = await acceptRide();
            if (result.success) {
              const isRelocation = RELOCATION_SCENARIOS.has(incomingRequest.scenario ?? '');
              navigate(`/ride/${incomingRequest.rideId}/${isRelocation ? 'relocation' : 'navigate'}`);
            } else {
              // Surface the failure to RideRequestModal so it can show
              // the inline acceptError banner instead of silently
              // re-enabling the button with no feedback.
              throw new Error(
                (result as { error?: string }).error
                  ?? "Couldn't accept that ride. Try again or wait for the next offer.",
              );
            }
          }}
          onDecline={() => declineRide()}
          onExpired={() => dismissRequest()}
        />
      )}

      {/* Ride cancelled by member/dispatcher notification */}
      {serverCancelled && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: colors.bgOverlay,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}>
          <Card style={{ maxWidth: 340, width: '100%' }} padding={28}>
            <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 12 }}>🚫</div>
            <div className="heading-editorial heading-editorial-md" style={{ textAlign: 'center', marginBottom: 8 }}>
              Ride Cancelled
            </div>
            <div style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', marginBottom: 24, lineHeight: 1.5 }}>
              This ride was cancelled by the member or your dispatcher. Your rating is unaffected — you're back online and ready for the next assignment.
            </div>
            <Button
              onClick={() => setServerCancelled(false)}
              variant="primary"
              fullWidth
            >
              Got it
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
