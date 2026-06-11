// ============================================================
// MCC Driver — Live Tracking Publisher (Step 3)
// Spec: mcc-live-tracking-spec-v4-FINAL.pdf §4, §5, §7
//
// Foreground-only for v1 (no UIBackgroundModes: location).
// v1.1 will add the background entitlement after App Store
// resubmission clears.
//
// Subject derivation — all seven handoff_leg values:
//   member_to_driver / driver_to_shop / shop_to_driver /
//   driver_to_member / driver_to_driver  →  member_vehicle
//   member_to_provider / provider_to_member  →  null (no publisher)
//   chase role (any leg)  →  driver_vehicle / chase
// ============================================================

import { supabase }          from '@/services/supabase/client';
import { startWatching, getCurrent } from '@/services/location';
import type { LocationFix, WatchHandle } from '@/services/location';
import { realtimeManager }   from '@/services/realtime/realtimeManager';
import { enqueue, flush }    from '@/services/offlineQueue';
import { onNetworkRestored } from '@/hooks/useNetworkStatus';
import { apiUrl }            from '@/services/api/baseUrl';
import type { HandoffLeg }   from '@/services/custody/custody.types';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TrackingSubject = 'member_vehicle' | 'driver_vehicle';
export type DriverRole      = 'primary' | 'chase';
export type EventKind       = 'leg' | 'road_test' | 'tow';

export interface PublisherParams {
  jobId:      string;
  legId:      string;
  handoffId:  string;
  leg:        HandoffLeg;
  driverRole?: DriverRole;  // defaults to 'primary'
  eventKind?:  EventKind;   // defaults to 'leg'
}

interface ResolvedParams extends Required<Omit<PublisherParams, 'driverRole' | 'eventKind'>> {
  driverRole: DriverRole;
  eventKind:  EventKind;
  subject:    TrackingSubject;
  driverId:   string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCURACY_DROP_M      = 50;   // drop fix if accuracy worse than this
const JITTER_SKIP_M        = 5;    // skip broadcast if < 5 m from last broadcast
const SPEED_BUF_SIZE       = 3;    // 3-ping rolling average for speed_smoothed
const SPEED_NOISE_MPS      = 3 * 0.44704; // 3 mph → m/s noise floor
const ACCURACY_SPEED_HIDE  = 25;   // hide speed when accuracy > 25 m
const DURABLE_INTERVAL_MS  = 30_000;
const MOVEMENT_FLAG_M      = 200;  // movement-before-attestation threshold

// ── Haversine (publisher-local copy — no shared dep to keep tree clean) ───────

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── Subject derivation ────────────────────────────────────────────────────────

function deriveSubject(leg: HandoffLeg, role: DriverRole): TrackingSubject | null {
  if (role === 'chase') return 'driver_vehicle';
  switch (leg) {
    case 'member_to_driver':
    case 'driver_to_shop':
    case 'shop_to_driver':
    case 'driver_to_member':
    case 'driver_to_driver':
      return 'member_vehicle';
    case 'member_to_provider':
    case 'provider_to_member':
      // No driver leg — member drops/picks up directly at provider.
      // Per spec §1 decision 5: show status card only, never publish.
      return null;
    default:
      return null;
  }
}

// ── Publisher ─────────────────────────────────────────────────────────────────

type Listener = () => void;

class TrackingPublisher {
  private _p:                ResolvedParams | null = null;
  private _watchHandle:      WatchHandle | null = null;
  private _durableTimer:     ReturnType<typeof setInterval> | null = null;
  private _netUnsub:         (() => void) | null = null;

  private _lastFix:          LocationFix | null = null;
  private _lastBroadcastPos: { lat: number; lng: number } | null = null;
  private _legStartPos:      { lat: number; lng: number } | null = null;

  private _speedBuf:         (number | null)[] = [];  // raw m/s, newest first
  private _attested =        false;
  private _movementFlagged = false;
  private _isPublishing =    false;

  private _listeners =       new Set<Listener>();

  // ── Public state ────────────────────────────────────────────────────────────

  get isPublishing(): boolean { return this._isPublishing; }

  /** Speed in mph after noise-floor / accuracy filter; null when hidden. */
  get currentSpeedMph(): number | null {
    const mps = this._smoothed();
    if (mps === null) return null;
    return mps * 2.23694;
  }

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async start(params: PublisherParams): Promise<void> {
    const role    = params.driverRole ?? 'primary';
    const subject = deriveSubject(params.leg, role);
    if (subject === null) return; // member_to_provider / provider_to_member

    await this._teardown();

    // Gate: check live_tracking_enabled before opening channel.
    const { data: job } = await supabase
      .from('concierge_jobs')
      .select('live_tracking_enabled')
      .eq('id', params.jobId)
      .maybeSingle();
    if (!job?.live_tracking_enabled) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    this._p = {
      ...params,
      driverRole: role,
      eventKind:  params.eventKind ?? 'leg',
      subject,
      driverId:   session.user.id,
    };
    this._attested       = false;
    this._movementFlagged = false;
    this._speedBuf       = [];
    this._lastBroadcastPos = null;
    this._lastFix        = null;

    // Open broadcast channel.
    const key     = `track:job:${params.jobId}`;
    const channel = supabase.channel(key, { config: { broadcast: { self: false } } });
    realtimeManager.subscribe(key, channel);
    channel.subscribe();

    // Seed start position + write an opening durable ping.
    const initial = await getCurrent();
    if (initial) {
      this._lastFix          = initial;
      this._legStartPos      = { lat: initial.lat, lng: initial.lng };
      this._lastBroadcastPos = { lat: initial.lat, lng: initial.lng };
      await this._writeDurable(initial);
    }

    // 30-second durable-ping timer.
    this._durableTimer = setInterval(() => {
      if (this._lastFix) void this._writeDurable(this._lastFix);
    }, DURABLE_INTERVAL_MS);

    // Capacitor-aware network-restore flush (supplements offlineQueue's
    // window.online listener, which may not fire on cellular drops).
    this._netUnsub = onNetworkRestored(() => void flush());

    // Start GPS watch.
    this._watchHandle = await startWatching(
      (fix) => this._onFix(fix),
      { minIntervalMs: 4_000 },
    );

    this._isPublishing = true;
    this._notify();
  }

  async stop(): Promise<void> {
    if (!this._isPublishing || !this._p) return;
    // Write a stop-marker durable ping before teardown.
    if (this._lastFix) await this._writeDurable(this._lastFix);
    await this._teardown();
  }

  /** Called by hook/screen when the receiving attestation is confirmed. */
  notifyAttested(): void {
    this._attested = true;
  }

  /** Pause tracking for a custody hold — writes hold_start event. */
  async secureHold(handoffId: string, photoPath: string | null): Promise<void> {
    const pos = this._lastFix ?? await getCurrent();
    if (pos && this._p) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.from('custody_hold_events').insert({
          handoff_id: handoffId,
          driver_id:  session.user.id,
          kind:       'hold_start',
          lat:        pos.lat,
          lng:        pos.lng,
          accuracy:   pos.accuracy,
          photo_path: photoPath ?? null,
        });
      }
    }
    await this.stop();
  }

  /** Resume after a hold — writes hold_end event and restarts. */
  async resumeFromHold(handoffId: string): Promise<void> {
    const pos = await getCurrent();
    const { data: { session } } = await supabase.auth.getSession();
    if (pos && session) {
      await supabase.from('custody_hold_events').insert({
        handoff_id: handoffId,
        driver_id:  session.user.id,
        kind:       'hold_end',
        lat:        pos.lat,
        lng:        pos.lng,
        accuracy:   pos.accuracy,
        photo_path: null,
      });
    }
    // Re-start with the same params. _p was cleared by stop(); preserve it.
    if (this._p) {
      const params: PublisherParams = {
        jobId:      this._p.jobId,
        legId:      this._p.legId,
        handoffId:  this._p.handoffId,
        leg:        this._p.leg,
        driverRole: this._p.driverRole,
        eventKind:  this._p.eventKind,
      };
      await this.start(params);
    }
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private _onFix(fix: LocationFix): void {
    const p = this._p;
    if (!p) return;

    // 1. Accuracy gate.
    if (fix.accuracy !== null && fix.accuracy > ACCURACY_DROP_M) return;

    this._lastFix = fix;

    // 2. Speed buffer (newest first, max 3).
    const rawMps = fix.speed;
    this._speedBuf = [rawMps, ...this._speedBuf].slice(0, SPEED_BUF_SIZE);

    // 3. Jitter suppression.
    if (this._lastBroadcastPos) {
      const dist = haversineM(
        this._lastBroadcastPos.lat, this._lastBroadcastPos.lng,
        fix.lat, fix.lng,
      );
      if (dist < JITTER_SKIP_M) return;
    }

    this._lastBroadcastPos = { lat: fix.lat, lng: fix.lng };

    // 4. Broadcast.
    const smoothed = this._smoothedRaw();
    const speedHidden = (fix.accuracy !== null && fix.accuracy > ACCURACY_SPEED_HIDE)
      || (smoothed !== null && smoothed < SPEED_NOISE_MPS);

    const payload = {
      ts:           fix.timestamp,
      lat:          fix.lat,
      lng:          fix.lng,
      heading:      fix.heading,
      speed:        rawMps ?? null,
      speed_smoothed: speedHidden ? null : smoothed,
      accuracy:     fix.accuracy,
      subject:      p.subject,
      driver_role:  p.driverRole,
      driver_id:    p.driverId,
      event_kind:   p.eventKind,
      low_power:    false, // TODO: detect via @capacitor/battery in v1.1
      mock:         false, // TODO: Android isFromMockProvider not exposed by Capacitor
    };

    const ch = supabase.getChannels().find(c => c.topic === `realtime:track:job:${p.jobId}`);
    ch?.send({ type: 'broadcast', event: 'loc_ping', payload }).catch(() => undefined);

    // 5. Movement-before-attestation check.
    if (!this._attested && !this._movementFlagged && this._legStartPos) {
      const moved = haversineM(
        this._legStartPos.lat, this._legStartPos.lng,
        fix.lat, fix.lng,
      );
      if (moved > MOVEMENT_FLAG_M) {
        this._movementFlagged = true;
        void this._postOpsFlag('movement_before_attestation', p.jobId, p.handoffId);
      }
    }

    this._notify();
  }

  private _smoothedRaw(): number | null {
    const vals = this._speedBuf.filter((v): v is number => v !== null);
    if (vals.length === 0) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  /** Smoothed speed with noise floor applied; null when below threshold. */
  private _smoothed(): number | null {
    const v = this._smoothedRaw();
    if (v === null || v < SPEED_NOISE_MPS) return null;
    return v;
  }

  private async _writeDurable(fix: LocationFix): Promise<void> {
    const p = this._p;
    if (!p) return;
    const smoothed = this._smoothedRaw();
    const row = {
      job_id:         p.jobId,
      handoff_id:     p.handoffId,
      driver_id:      p.driverId,
      subject:        p.subject,
      driver_role:    p.driverRole,
      leg:            p.leg,
      event_kind:     p.eventKind,
      lat:            fix.lat,
      lng:            fix.lng,
      heading:        fix.heading,
      speed:          fix.speed ?? null,
      speed_smoothed: smoothed,
      accuracy:       fix.accuracy,
      low_power:      false,
      mock:           false,
      device_ts:      new Date(fix.timestamp).toISOString(),
    };
    const doInsert = async () => {
      const { error } = await supabase.from('tracking_pings').insert(row);
      if (error) throw error;
    };
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      enqueue(doInsert, `tp:${p.jobId}:${fix.timestamp}`);
      return;
    }
    try {
      await doInsert();
    } catch {
      enqueue(doInsert, `tp:${p.jobId}:${fix.timestamp}`);
    }
  }

  private async _postOpsFlag(kind: string, jobId: string, handoffId: string): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(apiUrl('/tracking/flag'), {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ kind, job_id: jobId, handoff_id: handoffId }),
      });
    } catch {
      // best-effort — ops-flag write failure is non-critical
    }
  }

  private async _teardown(): Promise<void> {
    if (this._watchHandle) {
      await this._watchHandle.cancel();
      this._watchHandle = null;
    }
    if (this._durableTimer !== null) {
      clearInterval(this._durableTimer);
      this._durableTimer = null;
    }
    if (this._netUnsub) {
      this._netUnsub();
      this._netUnsub = null;
    }
    if (this._p) {
      realtimeManager.unsubscribe(`track:job:${this._p.jobId}`);
    }
    this._p            = null;
    this._lastFix      = null;
    this._legStartPos  = null;
    this._isPublishing = false;
    this._notify();
  }

  private _notify(): void {
    for (const fn of this._listeners) fn();
  }
}

// Singleton — one publisher per app session.
export const trackingPublisher = new TrackingPublisher();
