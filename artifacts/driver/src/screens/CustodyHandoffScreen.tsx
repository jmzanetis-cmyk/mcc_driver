// ============================================================
// MCC Driver — Custody Handoff Screen
// ============================================================
// Guided custody chain handoff UI for all four driver legs:
//   member_to_driver   — driver accepts from member
//   driver_to_shop     — driver releases to shop
//   shop_to_driver     — driver accepts from shop
//   driver_to_member   — driver releases to member
//
// Route: /custody  (optional ?rideId=<uuid> for release context)
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/services/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button, Card, PageHeader, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import {
  captureLiveShot, uploadCustodyPhoto, acceptHandoff, disputeHandoff,
  subscribeToJobChain, type CapturedShot,
} from '@/services/custody/custody.client';
import {
  createHandoff, releaseHandoff, getJobContextForRide,
  type JobContext,
} from '@/services/custody/custody.api';
import {
  FULL_ANGLE_SET,
  type CustodyHandoff,
  type HandoffLeg,
  type HandoffStatus,
  type PhotoAngle,
  type DisputeType,
} from '@/services/custody/custody.types';

// ── constants ────────────────────────────────────────────────────────────────

const LEG_LABEL: Record<HandoffLeg, string> = {
  member_to_driver: 'Pickup from Member',
  driver_to_shop:   'Drop-off to Shop',
  shop_to_driver:   'Return from Shop',
  driver_to_member: 'Return to Member',
  driver_to_driver: 'Driver Relay',
  member_to_provider: 'Member → Provider',
  provider_to_member: 'Provider → Member',
};

const LEG_PARTY_FROM: Record<HandoffLeg, string> = {
  member_to_driver: 'Member',
  driver_to_shop:   'You',
  shop_to_driver:   'Shop',
  driver_to_member: 'You',
  driver_to_driver: 'Driver',
  member_to_provider: 'Member',
  provider_to_member: 'Provider',
};

const LEG_PARTY_TO: Record<HandoffLeg, string> = {
  member_to_driver: 'You',
  driver_to_shop:   'Shop',
  shop_to_driver:   'You',
  driver_to_member: 'Member',
  driver_to_driver: 'Driver',
  member_to_provider: 'Provider',
  provider_to_member: 'Member',
};

const STATUS_BADGE: Record<HandoffStatus, { label: string; color: string; bg: string }> = {
  pending:          { label: 'Pending',           color: '#92400e', bg: 'rgba(245,158,11,0.12)' },
  awaiting_receiver:{ label: 'Awaiting You',      color: '#1d4ed8', bg: 'rgba(59,130,246,0.12)' },
  accepted:         { label: 'Accepted',           color: '#065f46', bg: 'rgba(16,185,129,0.12)' },
  disputed:         { label: 'Disputed',           color: '#991b1b', bg: 'rgba(239,68,68,0.12)' },
};

const ANGLE_META: Record<PhotoAngle, { label: string; hint: string; icon: string }> = {
  front:          { label: 'Front',           icon: '▲', hint: 'Stand directly in front. Frame full bumper to roofline.' },
  rear:           { label: 'Rear',            icon: '▼', hint: 'Stand directly behind. Frame the full rear end.' },
  driver_side:    { label: "Driver's Side",   icon: '◀', hint: "Left side profile — both wheels visible." },
  passenger_side: { label: "Passenger's Side",icon: '▶', hint: "Right side profile — both wheels visible." },
  roof:           { label: 'Roof',            icon: '⬛', hint: 'From a slight angle — capture the full roof panel.' },
  wheel_fl:       { label: 'Wheel: Front-L',  icon: '⭕', hint: 'Close-up of front-left wheel and tire.' },
  wheel_fr:       { label: 'Wheel: Front-R',  icon: '⭕', hint: 'Close-up of front-right wheel and tire.' },
  wheel_rl:       { label: 'Wheel: Rear-L',   icon: '⭕', hint: 'Close-up of rear-left wheel and tire.' },
  wheel_rr:       { label: 'Wheel: Rear-R',   icon: '⭕', hint: 'Close-up of rear-right wheel and tire.' },
  interior_front: { label: 'Interior Front',  icon: '🪑', hint: 'Front seats and dashboard — doors open.' },
  interior_rear:  { label: 'Interior Rear',   icon: '🪑', hint: 'Rear seat area and floor.' },
  cargo:          { label: 'Cargo / Trunk',   icon: '📦', hint: 'Trunk or cargo area with lid open.' },
  odometer:       { label: 'Odometer',        icon: '🔢', hint: 'Dashboard — show mileage reading clearly.' },
  other:          { label: 'Additional',      icon: '📷', hint: 'Any other relevant condition to document.' },
};

const DISPUTE_TYPES: { value: DisputeType; label: string; detail: string }[] = [
  { value: 'new_damage',         label: 'New Damage',          detail: 'Damage that appeared after I last released the vehicle' },
  { value: 'missing_item',       label: 'Missing Item',        detail: 'Something that was present is now gone' },
  { value: 'condition_mismatch', label: 'Condition Mismatch',  detail: 'General disagreement with how the vehicle was left' },
  { value: 'cleaning_revealed',  label: 'Cleaning Revealed',   detail: 'A wash exposed damage that was previously hidden' },
];

// ── types ────────────────────────────────────────────────────────────────────

interface PendingAccept {
  kind: 'accept';
  handoffId: string;
  jobId: string;
  leg: HandoffLeg;
  releasingPartyId: string;
}

interface PendingRelease {
  kind: 'release';
  jobId: string;
  leg: HandoffLeg;
  receivingPartyId: string;
  receivingPartyRole: 'member' | 'provider';
}

type PendingItem = PendingAccept | PendingRelease;

type Mode =
  | { tag: 'loading' }
  | { tag: 'error'; msg: string }
  | { tag: 'list'; items: PendingItem[]; allHandoffs: CustodyHandoff[] }
  | {
      tag: 'capture';
      subflow: 'accept' | 'release';
      jobId: string;
      handoffId: string;
      leg: HandoffLeg;
      angleIndex: number;
      capturing: boolean;
      captureError: string | null;
    }
  | {
      tag: 'attest';
      handoffId: string;
      jobId: string;
      leg: HandoffLeg;
      photoCount: number;
    }
  | {
      tag: 'dispute_form';
      handoffId: string;
      jobId: string;
      disputeType: DisputeType | null;
      notes: string;
    }
  | { tag: 'submitting'; label: string }
  | { tag: 'done'; msg: string; icon: string };

// ── helpers ──────────────────────────────────────────────────────────────────

function derivePendingItems(
  handoffs: CustodyHandoff[],
  driverUid: string,
  jobContext: Record<string, JobContext>,
): PendingItem[] {
  const items: PendingItem[] = [];
  // Group by job
  const byJob = new Map<string, CustodyHandoff[]>();
  for (const h of handoffs) {
    const arr = byJob.get(h.job_id) ?? [];
    arr.push(h);
    byJob.set(h.job_id, arr);
  }

  for (const [jobId, chain] of byJob) {
    const sorted = [...chain].sort((a, b) => a.sequence - b.sequence);
    const ctx = jobContext[jobId];

    for (const h of sorted) {
      // Accept: driver is the receiver and handoff is awaiting acceptance
      if (h.receiving_party_id === driverUid && h.status === 'awaiting_receiver') {
        items.push({ kind: 'accept', handoffId: h.id, jobId, leg: h.leg, releasingPartyId: h.releasing_party_id });
        break; // only one pending action per job at a time
      }
    }

    // Release: check if the driver accepted a handoff but the next leg hasn't been created
    const accepted = sorted.filter((h) => h.releasing_party_id === driverUid || h.receiving_party_id === driverUid);
    const lastDriverAccepted = [...accepted].reverse().find(
      (h) => h.receiving_party_id === driverUid && h.status === 'accepted',
    );

    if (lastDriverAccepted) {
      const nextLeg: HandoffLeg | null =
        lastDriverAccepted.leg === 'member_to_driver' ? 'driver_to_shop' :
        lastDriverAccepted.leg === 'shop_to_driver' ? 'driver_to_member' : null;

      if (nextLeg) {
        const alreadyExists = sorted.some((h) => h.leg === nextLeg && h.releasing_party_id === driverUid);
        if (!alreadyExists) {
          // For driver_to_member: receiving party = the member (releasing_party_id of member_to_driver)
          if (nextLeg === 'driver_to_member') {
            const mtd = sorted.find((h) => h.leg === 'member_to_driver');
            if (mtd) {
              items.push({ kind: 'release', jobId, leg: nextLeg, receivingPartyId: mtd.releasing_party_id, receivingPartyRole: 'member' });
            }
          }
          // For driver_to_shop: receiving party = provider (from job context)
          if (nextLeg === 'driver_to_shop' && ctx?.providerId) {
            items.push({ kind: 'release', jobId, leg: nextLeg, receivingPartyId: ctx.providerId, receivingPartyRole: 'provider' });
          }
        }
      }
    }
  }

  return items;
}

// ── component ────────────────────────────────────────────────────────────────

export function CustodyHandoffScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { driver } = useAuth();
  const rideId = searchParams.get('rideId');

  const [mode, setMode] = useState<Mode>({ tag: 'loading' });
  const unsubRef = useRef<(() => void) | null>(null);

  const driverUid = driver?.userId ?? null;

  // ── load pending handoffs ────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!driverUid) return;
    setMode({ tag: 'loading' });
    try {
      // Fetch all handoffs the driver is party to (RLS scopes via is_job_party SECURITY DEFINER)
      const { data, error } = await supabase
        .from('custody_handoffs')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const handoffs = (data ?? []) as CustodyHandoff[];

      // Build job context map (for releases that need provider_id)
      const jobContext: Record<string, JobContext> = {};
      if (rideId) {
        const ctx = await getJobContextForRide(rideId);
        if (ctx) jobContext[ctx.jobId] = ctx;
      }

      const items = derivePendingItems(handoffs, driverUid, jobContext);
      setMode({ tag: 'list', items, allHandoffs: handoffs });

      // Subscribe to realtime updates for each unique job
      const jobIds = [...new Set(handoffs.map((h) => h.job_id))];
      if (jobIds.length > 0) {
        // Subscribe to the first/most recent active job for live updates
        unsubRef.current?.();
        unsubRef.current = subscribeToJobChain(supabase, jobIds[0], () => void load());
      }
    } catch (e) {
      setMode({ tag: 'error', msg: e instanceof Error ? e.message : 'Failed to load handoffs' });
    }
  }, [driverUid, rideId]);

  useEffect(() => {
    void load();
    return () => { unsubRef.current?.(); };
  }, [load]);

  // ── start accept (incoming handoff) ─────────────────────────────────────

  const startAccept = (item: PendingAccept) => {
    setMode({
      tag: 'capture',
      subflow: 'accept',
      jobId: item.jobId,
      handoffId: item.handoffId,
      leg: item.leg,
      angleIndex: 0,
      capturing: false,
      captureError: null,
    });
  };

  // ── start release (outgoing handoff) ────────────────────────────────────

  const startRelease = async (item: PendingRelease) => {
    if (!driverUid) return;
    setMode({ tag: 'submitting', label: 'Creating handoff record…' });
    try {
      const handoff = await createHandoff({
        jobId: item.jobId,
        leg: item.leg,
        releasingPartyRole: 'driver',
        receivingPartyId: item.receivingPartyId,
        receivingPartyRole: item.receivingPartyRole,
      });
      setMode({
        tag: 'capture',
        subflow: 'release',
        jobId: item.jobId,
        handoffId: handoff.id,
        leg: item.leg,
        angleIndex: 0,
        capturing: false,
        captureError: null,
      });
    } catch (e) {
      setMode({ tag: 'error', msg: e instanceof Error ? e.message : 'Failed to create handoff' });
    }
  };

  // ── capture one photo ────────────────────────────────────────────────────

  const captureNext = async () => {
    if (mode.tag !== 'capture' || mode.capturing || !driverUid) return;

    const angle = FULL_ANGLE_SET[mode.angleIndex];
    if (!angle) return;

    setMode((m) => m.tag === 'capture' ? { ...m, capturing: true, captureError: null } : m);

    let shot: CapturedShot;
    try {
      shot = await captureLiveShot();
    } catch {
      setMode((m) => m.tag === 'capture' ? { ...m, capturing: false, captureError: 'Camera cancelled or unavailable. Tap to try again.' } : m);
      return;
    }

    // Upload immediately
    try {
      await uploadCustodyPhoto({
        supabase,
        jobId: mode.jobId,
        handoffId: mode.handoffId,
        capturedBy: driverUid,
        capturedByRole: 'driver',
        angle,
        shot,
      });
    } catch (e) {
      setMode((m) => m.tag === 'capture' ? { ...m, capturing: false, captureError: 'Upload failed — tap to retry.' } : m);
      return;
    }

    const nextIndex = mode.angleIndex + 1;
    if (nextIndex < FULL_ANGLE_SET.length) {
      setMode((m) => m.tag === 'capture' ? { ...m, capturing: false, captureError: null, angleIndex: nextIndex } : m);
    } else {
      // All photos captured
      const { subflow, handoffId, jobId, leg } = mode;
      if (subflow === 'accept') {
        setMode({ tag: 'attest', handoffId, jobId, leg, photoCount: FULL_ANGLE_SET.length });
      } else {
        // Release: show confirm step
        setMode({ tag: 'attest', handoffId, jobId, leg, photoCount: FULL_ANGLE_SET.length });
      }
    }
  };

  // ── accept handoff ───────────────────────────────────────────────────────

  const submitAccept = async (handoffId: string, notes?: string) => {
    setMode({ tag: 'submitting', label: 'Submitting acceptance…' });
    try {
      await acceptHandoff(supabase, handoffId, notes);
      setMode({ tag: 'done', msg: 'Handoff accepted. Condition recorded as baseline.', icon: '✅' });
    } catch (e) {
      setMode({ tag: 'error', msg: e instanceof Error ? e.message : 'Accept failed' });
    }
  };

  // ── dispute handoff ──────────────────────────────────────────────────────

  const submitDispute = async () => {
    if (mode.tag !== 'dispute_form' || !mode.disputeType) return;
    const { handoffId, disputeType, notes } = mode;
    setMode({ tag: 'submitting', label: 'Submitting dispute…' });
    try {
      await disputeHandoff(supabase, handoffId, disputeType, notes || undefined);
      setMode({ tag: 'done', msg: 'Dispute recorded. The MCC team has been notified.', icon: '⚠️' });
    } catch (e) {
      setMode({ tag: 'error', msg: e instanceof Error ? e.message : 'Dispute submission failed' });
    }
  };

  // ── release vehicle ──────────────────────────────────────────────────────

  const submitRelease = async (handoffId: string) => {
    setMode({ tag: 'submitting', label: 'Releasing vehicle…' });
    try {
      await releaseHandoff(handoffId, null, null, null);
      setMode({ tag: 'done', msg: 'Vehicle released. The receiving party has been notified.', icon: '🔑' });
    } catch (e) {
      setMode({ tag: 'error', msg: e instanceof Error ? e.message : 'Release failed' });
    }
  };

  // ── render ───────────────────────────────────────────────────────────────

  if (mode.tag === 'loading') {
    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
        <PageHeader title="Custody Handoffs" onBack={() => navigate(-1)} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size={28} color={colors.gold} />
        </div>
      </div>
    );
  }

  if (mode.tag === 'done') {
    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
        <PageHeader title="Custody Handoffs" onBack={() => navigate(-1)} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Card padding={32} style={{ textAlign: 'center', maxWidth: 360, width: '100%' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>{mode.icon}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: colors.navy, marginBottom: 8 }}>Done</div>
            <div style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 24, lineHeight: 1.6 }}>{mode.msg}</div>
            <Button onClick={() => void load()} variant="primary" fullWidth>Back to Handoffs</Button>
          </Card>
        </div>
      </div>
    );
  }

  if (mode.tag === 'error') {
    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
        <PageHeader title="Custody Handoffs" onBack={() => navigate(-1)} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Card padding={24} style={{ maxWidth: 360, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontSize: 14, color: colors.error, marginBottom: 20 }}>{mode.msg}</div>
            <Button onClick={() => void load()} variant="secondary" fullWidth>Retry</Button>
          </Card>
        </div>
      </div>
    );
  }

  if (mode.tag === 'submitting') {
    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
        <PageHeader title="Custody Handoffs" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <Spinner size={28} color={colors.gold} />
          <div style={{ fontSize: 14, color: colors.textSecondary }}>{mode.label}</div>
        </div>
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────

  if (mode.tag === 'list') {
    const { items, allHandoffs } = mode;
    const byJob = new Map<string, CustodyHandoff[]>();
    for (const h of allHandoffs) {
      const arr = byJob.get(h.job_id) ?? [];
      arr.push(h);
      byJob.set(h.job_id, arr);
    }

    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
        <PageHeader title="Custody Handoffs" onBack={() => navigate(-1)} />
        <div style={{ flex: 1, padding: '16px 16px 32px' }}>

          {/* Pending actions */}
          {items.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Action Required
              </div>
              {items.map((item, i) => (
                <Card key={i} padding={16} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: 24 }}>🔑</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: colors.navy }}>
                        {LEG_LABEL[item.leg]}
                      </div>
                      <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                        {item.kind === 'accept'
                          ? `${LEG_PARTY_FROM[item.leg]} has released the vehicle to you`
                          : `Release vehicle to ${LEG_PARTY_TO[item.leg]}`}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: borderRadius.full,
                      color: item.kind === 'accept' ? '#1d4ed8' : '#92400e',
                      background: item.kind === 'accept' ? 'rgba(59,130,246,0.12)' : 'rgba(245,158,11,0.12)',
                    }}>
                      {item.kind === 'accept' ? 'ACCEPT' : 'RELEASE'}
                    </span>
                  </div>
                  <Button
                    onClick={() => item.kind === 'accept' ? startAccept(item) : void startRelease(item)}
                    variant="primary"
                    fullWidth
                    size="md"
                  >
                    {item.kind === 'accept' ? 'Start Vehicle Check-In' : 'Start Vehicle Release'}
                  </Button>
                </Card>
              ))}
            </div>
          )}

          {/* Chain timeline per job */}
          {byJob.size > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Chain Timeline
              </div>
              {[...byJob.entries()].map(([jobId, handoffs]) => {
                const sorted = [...handoffs].sort((a, b) => a.sequence - b.sequence);
                return (
                  <Card key={jobId} padding={14} style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 10, fontFamily: 'monospace' }}>
                      Job {jobId.slice(0, 8)}…
                    </div>
                    {sorted.map((h, idx) => {
                      const badge = STATUS_BADGE[h.status];
                      return (
                        <div key={h.id} style={{ display: 'flex', gap: 12, marginBottom: idx < sorted.length - 1 ? 12 : 0 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <div style={{
                              width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                              background: h.status === 'accepted' ? colors.success : h.status === 'disputed' ? colors.error : colors.bgSecondary,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 12, color: h.status === 'accepted' || h.status === 'disputed' ? '#fff' : colors.textMuted,
                            }}>
                              {idx + 1}
                            </div>
                            {idx < sorted.length - 1 && (
                              <div style={{ width: 2, flex: 1, minHeight: 12, background: colors.border, marginTop: 4 }} />
                            )}
                          </div>
                          <div style={{ flex: 1, paddingBottom: idx < sorted.length - 1 ? 12 : 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy }}>
                                {LEG_LABEL[h.leg]}
                              </div>
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: borderRadius.full,
                                color: badge.color, background: badge.bg, flexShrink: 0, marginLeft: 8,
                              }}>
                                {badge.label}
                              </span>
                            </div>
                            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                              {LEG_PARTY_FROM[h.leg]} → {LEG_PARTY_TO[h.leg]}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </Card>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {items.length === 0 && byJob.size === 0 && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: colors.textMuted }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🔑</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: colors.navy, marginBottom: 8 }}>No active handoffs</div>
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                Custody handoffs will appear here when a member or shop initiates a vehicle transfer.
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Capture wizard ───────────────────────────────────────────────────────

  if (mode.tag === 'capture') {
    const angle = FULL_ANGLE_SET[mode.angleIndex];
    const meta = angle ? ANGLE_META[angle] : null;
    const total = FULL_ANGLE_SET.length;
    const done = mode.angleIndex;
    const isRelease = mode.subflow === 'release';

    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
        <PageHeader
          title={isRelease ? 'Release Photos' : 'Check-In Photos'}
          onBack={() => void load()}
        />

        <div style={{ flex: 1, padding: 20 }}>
          {/* Progress bar */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: colors.textMuted }}>
                {LEG_LABEL[mode.leg]}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: colors.navy }}>
                {done}/{total}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: colors.bgSecondary, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${(done / total) * 100}%`, background: colors.gold, borderRadius: 3, transition: 'width 0.3s ease' }} />
            </div>
          </div>

          {/* Angle card */}
          {meta && (
            <Card padding={24} style={{ marginBottom: 20, textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>{meta.icon}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: colors.navy, marginBottom: 8 }}>
                {meta.label}
              </div>
              <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6 }}>
                {meta.hint}
              </div>
            </Card>
          )}

          {/* Error */}
          {mode.captureError && (
            <div style={{
              padding: '10px 14px', borderRadius: borderRadius.md, marginBottom: 16,
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              fontSize: 13, color: colors.error,
            }}>
              {mode.captureError}
            </div>
          )}

          {/* Angle dot strip */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginBottom: 24, flexWrap: 'wrap' }}>
            {FULL_ANGLE_SET.map((_, i) => (
              <div key={i} style={{
                width: 8, height: 8, borderRadius: '50%',
                background: i < done ? colors.success : i === done ? colors.gold : colors.border,
              }} />
            ))}
          </div>
        </div>

        {/* Capture button */}
        <div style={{ padding: '0 20px 40px' }}>
          <Button
            onClick={() => void captureNext()}
            loading={mode.capturing}
            variant="primary"
            fullWidth
            size="lg"
          >
            {mode.capturing ? 'Opening camera…' : `📷  Capture ${meta?.label ?? 'Photo'}`}
          </Button>
          <Button
            onClick={() => void load()}
            variant="ghost"
            fullWidth
            size="sm"
            style={{ marginTop: 8 }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  // ── Attest (accept or release confirm) ──────────────────────────────────

  if (mode.tag === 'attest') {
    const isRelease = mode.leg === 'driver_to_shop' || mode.leg === 'driver_to_member';

    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
        <PageHeader title={isRelease ? 'Confirm Release' : 'Condition Review'} />
        <div style={{ flex: 1, padding: 20 }}>
          <Card padding={24} style={{ marginBottom: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📸</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: colors.navy, marginBottom: 8 }}>
              {mode.photoCount} photos captured
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6 }}>
              {isRelease
                ? `All condition photos are on record. Tap below to officially release the vehicle to ${LEG_PARTY_TO[mode.leg]}.`
                : `Review of ${LEG_LABEL[mode.leg]} complete. How's the vehicle condition?`}
            </div>
          </Card>

          {isRelease ? (
            <Button
              onClick={() => void submitRelease(mode.handoffId)}
              variant="success"
              fullWidth
              size="lg"
              style={{ marginBottom: 12 }}
            >
              Release Vehicle to {LEG_PARTY_TO[mode.leg]}
            </Button>
          ) : (
            <>
              <Button
                onClick={() => void submitAccept(mode.handoffId)}
                variant="success"
                fullWidth
                size="lg"
                style={{ marginBottom: 12 }}
              >
                Everything looks good — Accept
              </Button>
              <Button
                onClick={() => setMode({ tag: 'dispute_form', handoffId: mode.handoffId, jobId: mode.jobId, disputeType: null, notes: '' })}
                variant="danger"
                fullWidth
                size="md"
              >
                I see a problem — Dispute
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Dispute form ─────────────────────────────────────────────────────────

  if (mode.tag === 'dispute_form') {
    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
        <PageHeader title="Report an Issue" onBack={() => mode.tag === 'dispute_form' && setMode({ tag: 'attest', handoffId: mode.handoffId, jobId: mode.jobId, leg: 'member_to_driver', photoCount: FULL_ANGLE_SET.length })} />
        <div style={{ flex: 1, padding: 20 }}>
          <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 16, lineHeight: 1.6 }}>
            Select the issue type. Photos you captured are already attached as evidence.
          </div>

          {DISPUTE_TYPES.map(({ value, label, detail }) => {
            const selected = mode.disputeType === value;
            return (
              <div
                key={value}
                onClick={() => setMode((m) => m.tag === 'dispute_form' ? { ...m, disputeType: value } : m)}
                style={{
                  padding: 14, borderRadius: borderRadius.md, marginBottom: 10, cursor: 'pointer',
                  border: `2px solid ${selected ? colors.error : colors.border}`,
                  background: selected ? 'rgba(239,68,68,0.06)' : colors.bgCard,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${selected ? colors.error : colors.border}`,
                    background: selected ? colors.error : 'transparent',
                  }} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>{label}</div>
                    <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{detail}</div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Optional notes */}
          <div style={{ marginTop: 16, marginBottom: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: colors.navy, display: 'block', marginBottom: 6 }}>
              Additional notes (optional)
            </label>
            <textarea
              value={mode.notes}
              onChange={(e) => setMode((m) => m.tag === 'dispute_form' ? { ...m, notes: e.target.value } : m)}
              placeholder="Describe what you observed…"
              rows={3}
              style={{
                width: '100%', borderRadius: borderRadius.md, border: `1px solid ${colors.border}`,
                padding: '10px 12px', fontSize: 14, color: colors.textPrimary, background: colors.bgCard,
                resize: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        <div style={{ padding: '0 20px 40px' }}>
          <Button
            onClick={() => void submitDispute()}
            disabled={!mode.disputeType}
            variant="danger"
            fullWidth
            size="lg"
          >
            Submit Dispute
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
