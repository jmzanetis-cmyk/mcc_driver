// ============================================================
// MCC Driver — MarkerAnimator  (Step 4)
// Spec: §6 — smooth vehicle marker animation
//
// Lerps lat/lng over LERP_MS (matches publisher 4 s cadence).
// Bearing uses shortest-path angle interpolation; GPS heading is
// preferred when available; heading is held for moves < HOLD_M.
// New driver_id on the same subject key re-keys the marker so a
// relay handoff replaces the old dot cleanly.
//
// Usage:
//   const [animatedPings, setAnimatedPings] = useMarkerAnimator(rawPings);
// ============================================================

import { useEffect, useRef, useState } from 'react';
import type { LocPing, PingKey } from '@/hooks/useLiveTracking';
import { pingKey } from '@/hooks/useLiveTracking';

export interface AnimatedMarker {
  lat:     number;
  lng:     number;
  bearing: number;  // degrees, 0 = north
}

const LERP_MS = 4_000;
const HOLD_M  = 3;    // hold bearing when move is smaller than this

// ── Haversine (local copy to keep this service self-contained) ─────────────────

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R   = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function computeBearing(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad  = (d: number) => (d * Math.PI) / 180;
  const dLng = rad(bLng - aLng);
  const y    = Math.sin(dLng) * Math.cos(rad(bLat));
  const x    = Math.cos(rad(aLat)) * Math.sin(rad(bLat)) -
               Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function lerpAngle(from: number, to: number, t: number): number {
  let diff = to - from;
  while (diff > 180)  diff -= 360;
  while (diff < -180) diff += 360;
  return (from + diff * t + 360) % 360;
}

// ── Animation state per key ───────────────────────────────────────────────────

interface AnimState {
  fromLat:  number;
  fromLng:  number;
  fromBear: number;
  toLat:    number;
  toLng:    number;
  toBear:   number;
  startMs:  number;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMarkerAnimator(
  pings: Map<PingKey, LocPing>,
): Map<PingKey, AnimatedMarker> {
  // Animation registry: key → current AnimState
  const animStates = useRef<Map<PingKey, AnimState>>(new Map());
  // Current animated positions (what gets rendered)
  const animated   = useRef<Map<PingKey, AnimatedMarker>>(new Map());
  // Tracks the ping ts we last processed per key so we only update on new pings
  const processedTs = useRef<Map<PingKey, number>>(new Map());
  // rAF handle
  const rafId      = useRef<number | null>(null);
  // State trigger — only used to force a re-render when animated positions change
  const [, tick]   = useState(0);

  // On new pings arriving: compute animation state deltas
  useEffect(() => {
    for (const [k, ping] of pings) {
      const prevTs = processedTs.current.get(k) ?? 0;
      if (ping.ts <= prevTs) continue;
      processedTs.current.set(k, ping.ts);

      const cur = animated.current.get(k);
      const fromLat  = cur?.lat  ?? ping.lat;
      const fromLng  = cur?.lng  ?? ping.lng;
      const fromBear = cur?.bearing ?? 0;

      const distM = haversineM(fromLat, fromLng, ping.lat, ping.lng);

      let toBear: number;
      if (distM < HOLD_M) {
        // Too small a move — keep current bearing (hold rotation).
        toBear = fromBear;
      } else if (ping.heading !== null) {
        toBear = ping.heading;
      } else {
        toBear = computeBearing(fromLat, fromLng, ping.lat, ping.lng);
      }

      animStates.current.set(k, {
        fromLat, fromLng, fromBear,
        toLat:   ping.lat,
        toLng:   ping.lng,
        toBear,
        startMs: Date.now(),
      });
    }

    // Remove keys that are no longer in the pings map (driver left).
    for (const k of animStates.current.keys()) {
      if (!pings.has(k)) {
        animStates.current.delete(k);
        animated.current.delete(k);
      }
    }
  }, [pings]);

  // rAF loop — runs only while there are active animations
  useEffect(() => {
    let active = true;

    const frame = () => {
      if (!active) return;
      const now = Date.now();
      let anyMoving = false;

      for (const [k, s] of animStates.current) {
        const t = Math.min(1, (now - s.startMs) / LERP_MS);
        const lat     = s.fromLat  + (s.toLat  - s.fromLat)  * t;
        const lng     = s.fromLng  + (s.toLng  - s.fromLng)  * t;
        const bearing = lerpAngle(s.fromBear, s.toBear, t);
        animated.current.set(k, { lat, lng, bearing });
        if (t < 1) anyMoving = true;
      }

      tick((n) => n + 1); // trigger re-render

      if (anyMoving) {
        rafId.current = requestAnimationFrame(frame);
      } else {
        rafId.current = null;
      }
    };

    rafId.current = requestAnimationFrame(frame);

    return () => {
      active = false;
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };
  }, [pings]); // restart loop on any ping change

  return new Map(animated.current);
}

// ── Utility re-export so callers don't need to import useLiveTracking too ─────

export { pingKey };
export type { LocPing, PingKey };
