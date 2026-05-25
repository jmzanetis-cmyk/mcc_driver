// Single source of truth for MCC vehicle transport pricing.
// All monetary values are in cents to avoid floating-point drift.

export const TRANSPORT_RATES = {
  tiers: [
    { maxMiles: 5,  flatCents: 3500,  label: 'Under 5 mi' },
    { maxMiles: 10, flatCents: 5000,  label: '5–10 mi' },
    { maxMiles: 15, flatCents: 6500,  label: '10–15 mi' },
    { maxMiles: 20, flatCents: 8000,  label: '15–20 mi' },
    { maxMiles: 25, flatCents: 10000, label: '20–25 mi' },
  ],
  overageCentsPerMile: 400,        // $4/mi beyond 25 miles
  splits: {
    driverPercent:    75,
    insurancePercent:  7,
    platformPercent:  18,
  },
  tandemSurchargePercent: 50,      // total fare ×1.5 for tandem jobs
  tandemSplit: {
    primaryPercent: 55,            // of driver's 75% share
    chasePercent:   45,
  },
  minimumFareCents: 3500,
  tipPresets: [300, 500, 1000, 1500] as number[],
  tipWindowHours: 24,
  tipDriverPercent: 100,           // 100% of tip goes to driver(s)
} as const;

export interface TransportFareResult {
  totalCents: number;
  driverCents: number;
  insuranceCents: number;
  platformCents: number;
  tierLabel: string;
  primaryDriverCents: number | null;
  chaseDriverCents: number | null;
}

export function calculateTransportFare(
  distanceMiles: number,
  isTandem: boolean,
): TransportFareResult {
  const rates = TRANSPORT_RATES;

  const tier = rates.tiers.find(t => distanceMiles <= t.maxMiles);
  let baseCents: number;
  let tierLabel: string;

  if (tier) {
    baseCents  = tier.flatCents;
    tierLabel  = tier.label;
  } else {
    baseCents  = Math.round(distanceMiles * rates.overageCentsPerMile);
    tierLabel  = '25+ mi';
  }

  baseCents = Math.max(baseCents, rates.minimumFareCents);

  const totalCents = isTandem
    ? Math.round(baseCents * (1 + rates.tandemSurchargePercent / 100))
    : baseCents;

  const driverCents    = Math.round(totalCents * rates.splits.driverPercent    / 100);
  const insuranceCents = Math.round(totalCents * rates.splits.insurancePercent / 100);
  const platformCents  = totalCents - driverCents - insuranceCents;

  const primaryDriverCents = isTandem
    ? Math.round(driverCents * rates.tandemSplit.primaryPercent / 100)
    : null;
  const chaseDriverCents = isTandem
    ? driverCents - primaryDriverCents!
    : null;

  return {
    totalCents,
    driverCents,
    insuranceCents,
    platformCents,
    tierLabel,
    primaryDriverCents,
    chaseDriverCents,
  };
}

export interface MemberPriceResult {
  memberPaysCents: number;
  providerPaysCents: number;
}

export function calculateMemberPrice(
  totalCents: number,
  providerSubsidyPercent: number,
): MemberPriceResult {
  const providerPaysCents = Math.round(totalCents * providerSubsidyPercent / 100);
  return {
    memberPaysCents:  totalCents - providerPaysCents,
    providerPaysCents,
  };
}
