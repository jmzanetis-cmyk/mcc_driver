// ============================================================
// MCC — Tandem Ride-Along Fee Calculator
// ============================================================
// Distance-tier pricing per the MCC spec:
//   0–10 mi  → $25
//   10–25 mi → $40
//   25–50 mi → $65
//   50+ mi   → $90
// MCC retains a 15% platform fee on each ride-along booking.
// ============================================================

const DISTANCE_TIERS: { maxMiles: number; baseFee: number }[] = [
  { maxMiles: 10, baseFee: 25 },
  { maxMiles: 25, baseFee: 40 },
  { maxMiles: 50, baseFee: 65 },
  { maxMiles: Infinity, baseFee: 90 },
];

const MCC_PLATFORM_FEE_RATE = 0.15;

export interface RideAlongFeeBreakdown {
  baseFee: number;
  platformFee: number;
  partnerPayout: number;
  totalFee: number;
}

export function computeRideAlongFee(distanceMiles: number): RideAlongFeeBreakdown {
  const tier = DISTANCE_TIERS.find((t) => distanceMiles <= t.maxMiles)!;
  const baseFee = tier.baseFee;
  const platformFee = Math.round(baseFee * MCC_PLATFORM_FEE_RATE * 100) / 100;
  const partnerPayout = Math.round((baseFee - platformFee) * 100) / 100;
  return { baseFee, platformFee, partnerPayout, totalFee: baseFee };
}

export function getRideAlongFeeForDistance(distanceMiles: number): number {
  const tier = DISTANCE_TIERS.find((t) => distanceMiles <= t.maxMiles)!;
  return tier.baseFee;
}
