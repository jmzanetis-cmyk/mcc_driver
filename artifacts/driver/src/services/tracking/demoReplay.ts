// ============================================================
// MCC Driver — Demo Replay Engine (Step 8)
//
// Replays a scrubbed Bergen County, NJ ping trail through the
// normal TrackingPublisher pipeline at 4s cadence, exercising:
//   - Supabase Realtime broadcast
//   - tracking_pings durable writes
//   - speed smoothing, jitter suppression, accuracy gate
//
// App Review flow:
//   1. Demo driver +15555550199 / OTP 123456 signs in
//   2. DemoJobScreen → "Start Demo Leg"
//   3. Publisher starts; trail feeds through injectFixForDemo()
//   4. Reviewer-member account (mycarconcierge) watches the pin move
// ============================================================

import { trackingPublisher } from '@/services/tracking/publisher';
import type { PublisherParams } from '@/services/tracking/publisher';
import type { LocationFix } from '@/services/location';

// ── Known IDs (match seed-demo-concierge-job.sql) ─────────────────────────
export const DEMO_JOB_ID     = 'd0000000-0000-0000-0000-000000000001';
export const DEMO_HANDOFF_ID = 'd0000000-0000-0000-0000-000000000002';

const PING_INTERVAL_MS = 4_000;

// ── Bergen County trail ───────────────────────────────────────────────────
// Route: Hackensack (near NJ-17 / Rt 4) → auto-service shop in Paramus
// ~5.3 km, ~120 pings, ~25 mph average.  Coordinates scrubbed — no real
// addresses or identifiable landmarks encoded.
// [lat, lng, speedMps]
const WAYPOINTS: [number, number, number][] = [
  [40.8858, -74.0507,  5.0],  // start — slow departure
  [40.8903, -74.0516,  9.5],  // heading N on surface street
  [40.8975, -74.0525, 11.5],  // on-ramp approach
  [40.9048, -74.0540, 13.4],  // NJ-17 N (highway)
  [40.9118, -74.0557, 13.4],  // NJ-17 N continuing
  [40.9175, -74.0610,  9.0],  // exit ramp
  [40.9235, -74.0675,  7.5],  // surface streets
  [40.9285, -74.0722,  5.0],  // approaching destination
  [40.9315, -74.0750,  0.0],  // end — provider lot
];

// ── Helpers ───────────────────────────────────────────────────────────────

function haversineM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearing(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLng = rad(bLng - aLng);
  const y = Math.sin(dLng) * Math.cos(rad(bLat));
  const x = Math.cos(rad(aLat)) * Math.sin(rad(bLat))
          - Math.sin(rad(aLat)) * Math.cos(rad(bLat)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function buildTrail(): LocationFix[] {
  const STEP_M = 44.8; // 25 mph at 4 s
  const NOISE  = 0.000003; // ~0.3 m positional noise
  const fixes: LocationFix[] = [];
  const base = Date.now();

  for (let seg = 0; seg < WAYPOINTS.length - 1; seg++) {
    const [aLat, aLng, aSpd] = WAYPOINTS[seg];
    const [bLat, bLng, bSpd] = WAYPOINTS[seg + 1];
    const dist   = haversineM(aLat, aLng, bLat, bLng);
    const steps  = Math.max(1, Math.round(dist / STEP_M));
    const hdg    = bearing(aLat, aLng, bLat, bLng);

    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      fixes.push({
        lat:       aLat + (bLat - aLat) * t + (Math.random() - 0.5) * NOISE,
        lng:       aLng + (bLng - aLng) * t + (Math.random() - 0.5) * NOISE,
        heading:   hdg,
        accuracy:  8 + Math.random() * 7,
        speed:     aSpd + (bSpd - aSpd) * t,
        timestamp: base + fixes.length * PING_INTERVAL_MS,
      });
    }
  }
  return fixes;
}

// ── Module state ─────────────────────────────────────────────────────────

let _timer:  ReturnType<typeof setInterval> | null = null;
let _trail:  LocationFix[] = [];
let _cursor = 0;

// ── Public API ────────────────────────────────────────────────────────────

export async function startReplay(params: PublisherParams): Promise<boolean> {
  if (_timer !== null) return false;

  await trackingPublisher.start(params);
  if (!trackingPublisher.isPublishing) return false;

  _trail  = buildTrail();
  _cursor = 0;

  _timer = setInterval(() => {
    if (_cursor >= _trail.length) {
      void stopReplay();
      return;
    }
    trackingPublisher.injectFixForDemo(_trail[_cursor++]);
  }, PING_INTERVAL_MS);

  return true;
}

export async function stopReplay(): Promise<void> {
  if (_timer !== null) {
    clearInterval(_timer);
    _timer  = null;
  }
  _cursor = 0;
  if (trackingPublisher.isPublishing) await trackingPublisher.stop();
}

export function isReplaying(): boolean {
  return _timer !== null;
}

export function replayProgress(): { current: number; total: number } {
  return { current: _cursor, total: _trail.length };
}
