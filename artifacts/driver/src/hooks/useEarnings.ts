import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/services/supabase/client';
import type { AssignmentRow, RideRow } from '@/services/supabase/types';

export interface EarningsSummary {
  today: number;
  thisWeek: number;
  allTime: number;
  ridesToday: number;
  ridesThisWeek: number;
  ridesAllTime: number;
  averageRating: number;
}

export interface RideEarning {
  rideId: string;
  scenario: string;
  tier: string;
  pickupAddress: string;
  dropoffAddress: string;
  fare: number;
  driverPayout: number;
  tip: number;
  rating?: number;
  completedAt: string;
  distanceMiles: number;
}

interface AssignmentWithRide extends AssignmentRow {
  rides: RideRow | null;
}

interface DriverStats {
  average_rating: number;
  total_rides_completed: number;
}

async function fetchEarnings(driverId: string): Promise<{ summary: EarningsSummary; recentRides: RideEarning[] }> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - now.getDay() * 86400000);
  weekStart.setHours(0, 0, 0, 0);
  const weekStartISO = weekStart.toISOString();

  const { data: assignments } = await supabase
    .from('driver_assignments')
    .select(`
      ride_id, driver_payout_amount, completed_at,
      rides (
        id, scenario, tier, pickup_address, dropoff_address,
        actual_fare, tip_amount, member_rating, actual_distance_miles,
        completed_at
      )
    `)
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(100);

  const { data: driverData } = await supabase
    .from('drivers')
    .select('average_rating, total_rides_completed')
    .eq('id', driverId)
    .single();

  const driver = driverData as unknown as DriverStats | null;
  const rows = (assignments ?? []) as unknown as AssignmentWithRide[];

  let today = 0, thisWeek = 0, allTime = 0;
  let ridesToday = 0, ridesThisWeek = 0;
  const rides: RideEarning[] = [];

  for (const a of rows) {
    const ride = a.rides;
    if (!ride) continue;

    const payout = a.driver_payout_amount ?? 0;
    const tip = ride.tip_amount ?? 0;
    const total = payout + tip;
    const completedAt = ride.completed_at ?? a.completed_at ?? '';

    allTime += total;
    if (completedAt >= todayStart) { today += total; ridesToday++; }
    if (completedAt >= weekStartISO) { thisWeek += total; ridesThisWeek++; }

    rides.push({
      rideId: ride.id,
      scenario: ride.scenario,
      tier: ride.tier,
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

  return {
    summary: {
      today: Math.round(today * 100) / 100,
      thisWeek: Math.round(thisWeek * 100) / 100,
      allTime: Math.round(allTime * 100) / 100,
      ridesToday,
      ridesThisWeek,
      ridesAllTime: driver?.total_rides_completed ?? (assignments?.length ?? 0),
      averageRating: driver?.average_rating ?? 5.0,
    },
    recentRides: rides,
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
      today: 0, thisWeek: 0, allTime: 0,
      ridesToday: 0, ridesThisWeek: 0, ridesAllTime: 0,
      averageRating: 5.0,
    },
    recentRides: query.data?.recentRides ?? [],
    isLoading: query.isLoading,
    refreshEarnings: query.refetch,
  };
}
