// ============================================================
// MCC Driver — useLiveTracking  (Step 4)
// Spec: mcc-live-tracking-spec-v4-FINAL.pdf §4, §6
//
// Subscribes to the Realtime broadcast channel for a job or ride,
// deduplicates pings by (subject, driver_role, driver_id) key,
// enforces monotonic ts so out-of-order packets are dropped, seeds
// from DB on reconnect so the map has position before the next
// broadcast, and signals 15 s silence per key so the viewer can
// render a reconnecting indicator.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase }         from '@/services/supabase/client';
import { realtimeManager }  from '@/services/realtime/realtimeManager';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LocPing {
  ts:             number;         // epoch ms (device time, non-authoritative)
  lat:            number;
  lng:            number;
  heading:        number | null;
  speed:          number | null;  // m/s raw
  speed_smoothed: number | null;  // m/s 3-ping avg
  accuracy:       number | null;
  subject:        'member_vehicle' | 'driver_vehicle';
  driver_role:    'primary' | 'chase';
  driver_id:      string;
  event_kind:     'leg' | 'road_test' | 'tow';
  low_power:      boolean;
  mock:           boolean;
}

export type PingKey = string; // `${subject}:${driver_role}:${driver_id}`

export function pingKey(p: Pick<LocPing, 'subject' | 'driver_role' | 'driver_id'>): PingKey {
  return `${p.subject}:${p.driver_role}:${p.driver_id}`;
}

const SILENCE_MS         = 15_000; // emit 'reconnecting' if no ping for 15 s
const SILENCE_CHECK_MS   = 5_000;  // poll interval for silence detection
const SEED_FRESHNESS_SEC = 10 * 60;

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseLiveTrackingResult {
  pings:        Map<PingKey, LocPing>;
  reconnecting: Set<PingKey>;
}

export function useLiveTracking(jobId: string | null): UseLiveTrackingResult {
  const [pings,        setPings]        = useState<Map<PingKey, LocPing>>(new Map());
  const [reconnecting, setReconnecting] = useState<Set<PingKey>>(new Set());

  // lastPingMs tracks the most recent ping arrival time per key for silence detection.
  const lastPingMs = useRef<Map<PingKey, number>>(new Map());
  // lastTs per key for monotonic enforcement.
  const lastTs     = useRef<Map<PingKey, number>>(new Map());

  // ── Seed from DB ────────────────────────────────────────────────────────────
  const seedFromDb = useCallback(async (jId: string) => {
    const freshCutoff = new Date(Date.now() - SEED_FRESHNESS_SEC * 1000).toISOString();
    const { data } = await supabase
      .from('tracking_pings')
      .select('driver_id, subject, driver_role, lat, lng, heading, speed, speed_smoothed, accuracy, event_kind, low_power, mock, recorded_at')
      .eq('job_id', jId)
      .gte('recorded_at', freshCutoff)
      .order('recorded_at', { ascending: false })
      .limit(24);

    if (!data || data.length === 0) return;

    // Latest row per key.
    const seeded = new Map<PingKey, LocPing>();
    for (const row of data) {
      const k = `${row.subject}:${row.driver_role}:${row.driver_id}` as PingKey;
      if (!seeded.has(k)) {
        const ts = new Date(row.recorded_at as string).getTime();
        seeded.set(k, {
          ts,
          lat:            row.lat as number,
          lng:            row.lng as number,
          heading:        row.heading as number | null,
          speed:          row.speed as number | null,
          speed_smoothed: row.speed_smoothed as number | null,
          accuracy:       row.accuracy as number | null,
          subject:        row.subject as LocPing['subject'],
          driver_role:    row.driver_role as LocPing['driver_role'],
          driver_id:      row.driver_id as string,
          event_kind:     (row.event_kind ?? 'leg') as LocPing['event_kind'],
          low_power:      (row.low_power ?? false) as boolean,
          mock:           (row.mock ?? false) as boolean,
        });
        lastTs.current.set(k, ts);
        lastPingMs.current.set(k, Date.now());
      }
    }

    if (seeded.size > 0) {
      setPings((prev) => {
        const next = new Map(prev);
        for (const [k, p] of seeded) next.set(k, p);
        return next;
      });
    }
  }, []);

  // ── Ingest a broadcast ping ─────────────────────────────────────────────────
  const ingest = useCallback((ping: LocPing) => {
    const k = pingKey(ping);

    // Monotonic ts guard — drop stale/out-of-order packets.
    const prev = lastTs.current.get(k) ?? 0;
    if (ping.ts <= prev) return;
    lastTs.current.set(k, ping.ts);
    lastPingMs.current.set(k, Date.now());

    setPings((m) => {
      const next = new Map(m);
      next.set(k, ping);
      return next;
    });
    // Clear reconnecting for this key if it was flagged.
    setReconnecting((s) => {
      if (!s.has(k)) return s;
      const next = new Set(s);
      next.delete(k);
      return next;
    });
  }, []);

  // ── Channel subscription ────────────────────────────────────────────────────
  useEffect(() => {
    if (!jobId) return;

    const channelKey = `track:job:${jobId}`;

    void seedFromDb(jobId);

    const channel = supabase
      .channel(channelKey, { config: { broadcast: { ack: false } } })
      .on('broadcast', { event: 'loc_ping' }, ({ payload }) => {
        const p = payload as LocPing;
        if (p && typeof p.ts === 'number' && typeof p.lat === 'number') {
          ingest(p);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Re-seed on reconnect so map has position before next live ping.
          void seedFromDb(jobId);
        }
      });

    realtimeManager.subscribe(channelKey, channel);

    return () => {
      realtimeManager.unsubscribe(channelKey);
      lastTs.current.clear();
      lastPingMs.current.clear();
    };
  }, [jobId, ingest, seedFromDb]);

  // ── Silence detection — 15 s per key → reconnecting ────────────────────────
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      const stale = new Set<PingKey>();
      for (const [k, ms] of lastPingMs.current) {
        if (now - ms > SILENCE_MS) stale.add(k);
      }
      setReconnecting((prev) => {
        if (stale.size === 0 && prev.size === 0) return prev;
        // Only update if something changed.
        const changed = stale.size !== prev.size ||
          [...stale].some((k) => !prev.has(k));
        return changed ? stale : prev;
      });
    }, SILENCE_CHECK_MS);
    return () => clearInterval(iv);
  }, []);

  return { pings, reconnecting };
}
