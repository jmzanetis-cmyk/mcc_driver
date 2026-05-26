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

  // ── Demand multipliers ────────────────────────────────────────────────────
  multipliers: {
    rushHour: {
      rate: 1.25,
      label: 'Rush hour',
      windows: [
        { days: [1, 2, 3, 4, 5] as number[], startHour: 7,  endHour: 9  },
        { days: [1, 2, 3, 4, 5] as number[], startHour: 16, endHour: 19 },
      ],
    },
    lowSupply: {
      rate: 1.30,
      label: 'High demand',
      threshold: 3,                // online driver count ≤ this triggers it
    },
    night: {
      rate: 1.15,
      label: 'Night rate',
      startHour: 21,               // 9 PM
      endHour: 6,                  // 6 AM
    },
    holiday: {
      rate: 1.35,
      label: 'Holiday rate',
      enabled: false,
    },
    severeWeather: {
      rate: 1.40,
      label: 'Weather premium',
      enabled: false,
    },
  },
  maxMultiplierStack: 1.50,        // compounded multiplier capped at 1.5×

  // ── Wait time ─────────────────────────────────────────────────────────────
  waitTime: {
    gracePeriodMinutes: 5,
    maxWaitMinutes: 30,
    noShowCancelMinutes: 15,
    tandemMultiplier: 2,           // both drivers paid → 2× rate
  },
  showUpFee: { amountCents: 1500 },  // $15
  cancellationFees: {
    beforePickup: 0,
    afterDispatch: 0.25,           // 25% of base fare
    noShow: 0.25,                  // 25% of base fare
  },
} as const;

// ── Fare result ───────────────────────────────────────────────────────────────

export interface TransportFareResult {
  totalCents: number;              // = adjustedFareCents
  driverCents: number;
  insuranceCents: number;
  platformCents: number;
  tierLabel: string;
  primaryDriverCents: number | null;
  chaseDriverCents: number | null;
  multiplierRate: number;          // 1.0 when no multiplier active
  multiplierLabel: string;         // '' when no multiplier active
  baseFareCents: number;           // fare before multiplier
  adjustedFareCents: number;       // fare after multiplier (= totalCents)
}

// ── Multiplier helpers ────────────────────────────────────────────────────────

function isRushHour(t: Date): boolean {
  const day = t.getDay();
  const hour = t.getHours();
  return TRANSPORT_RATES.multipliers.rushHour.windows.some(
    (w) => w.days.includes(day) && hour >= w.startHour && hour < w.endHour,
  );
}

function isNight(t: Date): boolean {
  const hour = t.getHours();
  const { startHour, endHour } = TRANSPORT_RATES.multipliers.night;
  return hour >= startHour || hour < endHour;
}

export interface MultiplierOptions {
  requestTime?: Date;
  onlineDriverCount?: number;
  holidayActive?: boolean;
  weatherActive?: boolean;
}

// ── calculateTransportFare ────────────────────────────────────────────────────

export function calculateTransportFare(
  distanceMiles: number,
  isTandem: boolean,
  options?: MultiplierOptions,
): TransportFareResult {
  const rates = TRANSPORT_RATES;

  const tier = rates.tiers.find((t) => distanceMiles <= t.maxMiles);
  let baseCents: number;
  let tierLabel: string;

  if (tier) {
    baseCents = tier.flatCents;
    tierLabel = tier.label;
  } else {
    baseCents = Math.round(distanceMiles * rates.overageCentsPerMile);
    tierLabel = '25+ mi';
  }

  baseCents = Math.max(baseCents, rates.minimumFareCents);

  const baseTandemCents = isTandem
    ? Math.round(baseCents * (1 + rates.tandemSurchargePercent / 100))
    : baseCents;

  // ── Stack applicable multipliers, cap at maxMultiplierStack ─────────────
  const active: { rate: number; label: string }[] = [];

  if (options) {
    const t = options.requestTime ?? new Date();

    if (isRushHour(t)) {
      active.push({ rate: rates.multipliers.rushHour.rate, label: rates.multipliers.rushHour.label });
    }
    if (isNight(t)) {
      active.push({ rate: rates.multipliers.night.rate, label: rates.multipliers.night.label });
    }
    if (
      options.onlineDriverCount != null &&
      options.onlineDriverCount <= rates.multipliers.lowSupply.threshold
    ) {
      active.push({ rate: rates.multipliers.lowSupply.rate, label: rates.multipliers.lowSupply.label });
    }
    if (options.holidayActive === true && rates.multipliers.holiday.enabled) {
      active.push({ rate: rates.multipliers.holiday.rate, label: rates.multipliers.holiday.label });
    }
    if (options.weatherActive === true && rates.multipliers.severeWeather.enabled) {
      active.push({ rate: rates.multipliers.severeWeather.rate, label: rates.multipliers.severeWeather.label });
    }
  }

  let multiplierRate = active.reduce((acc, m) => acc * m.rate, 1.0);
  multiplierRate = Math.min(multiplierRate, rates.maxMultiplierStack);
  multiplierRate = Math.round(multiplierRate * 10000) / 10000; // 4 decimal precision

  const multiplierLabel = active.map((m) => m.label).join(' + ');
  const adjustedFareCents = Math.round(baseTandemCents * multiplierRate);
  const totalCents = adjustedFareCents;

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
    multiplierRate,
    multiplierLabel,
    baseFareCents: baseTandemCents,
    adjustedFareCents,
  };
}

// ── calculateMemberPrice ──────────────────────────────────────────────────────

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

// ── determineWaitTimePayer ────────────────────────────────────────────────────
// Returns who is billed for wait time.
//   - Return leg of a round trip (roundTripParentId set): pickup is at the
//     provider's shop → provider pays
//   - Provider-requested dispatch → provider pays
//   - Fleet transfer scenarios → dealer (use requestSource='dealer_requested')
//   - All other cases → member pays

export function determineWaitTimePayer(ride: {
  requestSource?: string | null;
  roundTripParentId?: string | null;
}): 'member' | 'provider' | 'dealer' {
  if (ride.roundTripParentId) return 'provider';
  if (ride.requestSource === 'provider_requested') return 'provider';
  if (ride.requestSource === 'dealer_requested') return 'dealer';
  return 'member';
}

// ── calculateWaitCents ────────────────────────────────────────────────────────
// Converts elapsed wait minutes to a billable amount. Grace period is free;
// tandem jobs double the rate (both drivers are being compensated).

export function calculateWaitCents(params: {
  elapsedMinutes: number;
  tripFareCents: number;      // used to derive per-minute rate
  estimatedTripMinutes: number;
  isTandem?: boolean;
}): number {
  const { elapsedMinutes, tripFareCents, estimatedTripMinutes, isTandem } = params;
  const { gracePeriodMinutes, tandemMultiplier } = TRANSPORT_RATES.waitTime;
  const billableMinutes = Math.max(0, elapsedMinutes - gracePeriodMinutes);
  if (billableMinutes === 0) return 0;
  const perMinuteCents = tripFareCents / Math.max(1, estimatedTripMinutes);
  const tandemFactor = isTandem ? tandemMultiplier : 1;
  return Math.round(billableMinutes * perMinuteCents * tandemFactor);
}
