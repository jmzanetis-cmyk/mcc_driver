import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/services/supabase/client';
import type { AssignmentRow, CashoutRow, RideRow } from '@/services/supabase/types';

export interface EarningsSummary {
  today: number;
  thisWeek: number;
  thisMonth: number;
  allTime: number;
  ridesToday: number;
  ridesThisWeek: number;
  ridesThisMonth: number;
  ridesAllTime: number;
  averageRating: number;
  totalTips: number;
  totalFares: number;
}

export interface RideEarning {
  rideId: string;
  scenario: string;
  tier: string;
  serviceType: string;
  pickupAddress: string;
  dropoffAddress: string;
  fare: number;
  driverPayout: number;
  tip: number;
  rating?: number;
  completedAt: string;
  distanceMiles: number;
}

export interface PayoutRecord {
  id: string;
  amount: number;
  netPayout: number | null;
  platformFee: number | null;
  method: 'instant' | 'standard';
  status: string;
  requestedAt: string | null;
  completedAt: string | null;
  scheduledDate: string | null;
  cardLast4: string | null;
  bankLast4: string | null;
  failedReason: string | null;
  createdAt: string;
}

interface AssignmentWithRide extends AssignmentRow {
  rides: RideRow | null;
}

interface DriverStats {
  average_rating: number;
  total_rides_completed: number;
}

async function fetchEarnings(driverId: string): Promise<{
  summary: EarningsSummary;
  recentRides: RideEarning[];
  payouts: PayoutRecord[];
  availableCents: number;
}> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - now.getDay() * 86400000);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartISO = weekStart.toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [
    { data: assignments, error: assignmentsError },
    { data: driverData, error: driverError },
    { data: cashoutData },
    { data: walletData },
  ] = await Promise.all([
    supabase
      .from('driver_assignments')
      .select(`
        ride_id, driver_payout_amount, completed_at,
        rides (
          id, scenario, tier, service_type, pickup_address, dropoff_address,
          actual_fare, tip_amount, member_rating, actual_distance_miles,
          completed_at
        )
      `)
      .eq('driver_id', driverId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(100),
    supabase
      .from('drivers')
      .select('average_rating, total_rides_completed')
      .eq('id', driverId)
      .single(),
    supabase
      .from('driver_cashouts')
      .select('id, amount_cents, fee_cents, method, status, error, requested_at, completed_at')
      .eq('driver_id', driverId)
      .order('requested_at', { ascending: false })
      .limit(20),
    supabase
      .from('driver_wallet_balances')
      .select('available_cents')
      .eq('driver_id', driverId)
      .maybeSingle(),
  ]);

  if (assignmentsError) throw assignmentsError;
  if (driverError) throw driverError;

  const driver = driverData as unknown as DriverStats | null;
  const rows = (assignments ?? []) as unknown as AssignmentWithRide[];

  let today = 0, thisWeek = 0, thisMonth = 0, allTime = 0;
  let ridesToday = 0, ridesThisWeek = 0, ridesThisMonth = 0;
  let totalTips = 0, totalFares = 0;
  const rides: RideEarning[] = [];

  for (const a of rows) {
    const ride = a.rides;
    if (!ride) continue;

    const payout = a.driver_payout_amount ?? 0;
    const tip = ride.tip_amount ?? 0;
    const total = payout + tip;
    const completedAt = ride.completed_at ?? a.completed_at ?? '';

    allTime += total;
    totalTips += tip;
    totalFares += payout;
    if (completedAt >= todayStart) { today += total; ridesToday++; }
    if (completedAt >= weekStartISO) { thisWeek += total; ridesThisWeek++; }
    if (completedAt >= monthStart) { thisMonth += total; ridesThisMonth++; }

    rides.push({
      rideId: ride.id,
      scenario: ride.scenario,
      tier: ride.tier,
      serviceType: ride.service_type ?? 'concierge',
      pickupAddress: ride.pickup_address,
      dropoffAddress: ride.dropoff_address,
      fare: ride.actual_fare ?? 0,
      driverPayout: payout,
      tip,
      rating: ride.member_rating ?? undefined,
      completedAt,
      distanceMiles: ride.actual_distance_miles ?? 0,
    });
  }

  const payouts: PayoutRecord[] = ((cashoutData ?? []) as unknown as CashoutRow[]).map((c) => ({
    id: c.id,
    amount: c.amount_cents / 100,
    netPayout: (c.amount_cents - c.fee_cents) / 100,
    platformFee: c.fee_cents / 100,
    method: c.method,
    status: c.status,
    requestedAt: c.requested_at,
    completedAt: c.completed_at,
    scheduledDate: null,
    cardLast4: null,
    bankLast4: null,
    failedReason: c.error,
    createdAt: c.requested_at,
  }));

  return {
    summary: {
      today: Math.round(today * 100) / 100,
      thisWeek: Math.round(thisWeek * 100) / 100,
      thisMonth: Math.round(thisMonth * 100) / 100,
      allTime: Math.round(allTime * 100) / 100,
      ridesToday,
      ridesThisWeek,
      ridesThisMonth,
      ridesAllTime: driver?.total_rides_completed ?? (assignments?.length ?? 0),
      averageRating: driver?.average_rating ?? 5.0,
      totalTips: Math.round(totalTips * 100) / 100,
      totalFares: Math.round(totalFares * 100) / 100,
    },
    recentRides: rides,
    payouts,
    availableCents: (walletData as { available_cents: number | null } | null)?.available_cents ?? 0,
  };
}

export function useEarnings(driverId: string | null) {
  const query = useQuery({
    queryKey: ['earnings', driverId],
    queryFn: () => fetchEarnings(driverId!),
    enabled: !!driverId,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  return {
    summary: query.data?.summary ?? {
      today: 0, thisWeek: 0, thisMonth: 0, allTime: 0,
      ridesToday: 0, ridesThisWeek: 0, ridesThisMonth: 0, ridesAllTime: 0,
      averageRating: 5.0,
      totalTips: 0, totalFares: 0,
    },
    recentRides: query.data?.recentRides ?? [],
    payouts: query.data?.payouts ?? [],
    availableCents: query.data?.availableCents ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refreshEarnings: query.refetch,
  };
}
