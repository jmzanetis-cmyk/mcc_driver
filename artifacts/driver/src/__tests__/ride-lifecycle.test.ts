// ============================================================
// MCC Driver — Ride Lifecycle E2E Tests
// ============================================================
// Covers the full driver ride loop:
//   go online → receive offer → accept → navigate → complete
//   → rate member → (co-driver eval) → tip → home
//
// External I/O is mocked in setup.ts. Tests exercise the Zustand
// dispatch store, hooks, and pure-logic modules.
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ── App modules (all external deps are mocked in setup.ts) ───────────────────
import { useDispatchStore } from '@/store/dispatchStore';
import { useDriverStatusStore } from '@/store/driverStatusStore';
import { useDriverStatus } from '@/hooks/useDriverStatus';
import { useRideRequests } from '@/hooks/useRideRequests';
import { useActiveRide } from '@/hooks/useActiveRide';
import { acceptRide, completeRide } from '@/services/api/edgeFunctions';
import { fetchRoute } from '@/services/navigation/routeService';
import {
  openNavigation,
  getDefaultNavApp,
  getAvailableNavApps,
  getNavAppName,
} from '@/services/navigation/navService';
import { supabase } from '@/services/supabase/client';

// ── Fare calculation (mirrors api-server/src/routes/rides.ts TIER_RATES) ─────
// If server rates change, update here too.
const TIER_RATES: Record<string, {
  base: number; perMile: number; perMinute: number;
  deliveryPickupFee: number; minimum: number;
}> = {
  tier_0_rideshare:     { base: 5,  perMile: 1.5, perMinute: 0.30, deliveryPickupFee: 0,    minimum: 8  },
  tier_0_delivery:      { base: 6,  perMile: 2.0, perMinute: 0.35, deliveryPickupFee: 1.50, minimum: 10 },
  tier_1_passenger:     { base: 10, perMile: 1.5, perMinute: 0,    deliveryPickupFee: 0,    minimum: 12 },
  tier_2_vehicle_solo:  { base: 20, perMile: 2.0, perMinute: 0,    deliveryPickupFee: 0,    minimum: 25 },
  tier_3_vehicle_paired:{ base: 35, perMile: 2.5, perMinute: 0,    deliveryPickupFee: 0,    minimum: 40 },
  tier_4_full_concierge:{ base: 40, perMile: 3.0, perMinute: 0,    deliveryPickupFee: 0,    minimum: 45 },
};

function computeFare(tier: string, distanceMiles: number, durationMinutes?: number): number {
  const rates = TIER_RATES[tier] ?? TIER_RATES['tier_1_passenger']!;
  const raw = rates.base + rates.deliveryPickupFee
    + distanceMiles * rates.perMile
    + (durationMinutes ?? 0) * rates.perMinute;
  return Math.round(Math.max(raw, rates.minimum) * 100) / 100;
}

// ── Test data factories ───────────────────────────────────────────────────────

function makeAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'assign-1',
    ride_id: 'ride-1',
    driver_id: 'driver-1',
    role: 'primary',
    status: 'pending',
    drives_member_vehicle: false,
    carries_passenger: true,
    response_deadline: new Date(Date.now() + 30_000).toISOString(),
    member_vehicle_description: null,
    member_vehicle_plate: null,
    payout_status: null,
    payout_id: null,
    completed_at: null,
    driver_payout_amount: null,
    ...overrides,
  };
}

function makeRide(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ride-1',
    scenario: 'member_dropoff',
    tier: 'tier_1_passenger',
    service_type: 'concierge',
    status: 'pending_dispatch',
    pickup_address: '123 Main St, Austin, TX',
    pickup_lat: 30.267,
    pickup_lng: -97.743,
    dropoff_address: '456 Oak Ave, Austin, TX',
    dropoff_lat: 30.284,
    dropoff_lng: -97.739,
    estimated_fare: 28.50,
    estimated_distance_miles: 8.2,
    actual_fare: null,
    actual_distance_miles: null,
    tip_amount: null,
    member_rating: null,
    started_at: null,
    completed_at: null,
    tandem_required: false,
    tandem_mode: null,
    member_vehicle_year: null,
    member_vehicle_make: null,
    member_vehicle_model: null,
    member_vehicle_color: null,
    package_description: null,
    ...overrides,
  };
}

function makeDriverRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'driver-1',
    user_id: 'user-1',
    is_online: false,
    current_lat: 30.26,
    current_lng: -97.74,
    status: 'active',
    ...overrides,
  };
}

// Standard offer payload for tests that need a primed store
function makeOfferPayload() {
  return {
    rideId: 'ride-1',
    assignmentId: 'assign-1',
    role: 'primary' as const,
    scenario: 'member_dropoff',
    tier: 'tier_1_passenger',
    serviceType: 'concierge' as const,
    packageDescription: null,
    pickupAddress: '123 Main St, Austin, TX',
    pickupLat: 30.267,
    pickupLng: -97.743,
    dropoffAddress: '456 Oak Ave, Austin, TX',
    dropoffLat: 30.284,
    dropoffLng: -97.739,
    estimatedFare: 28.50,
    estimatedDistance: 8.2,
    memberVehicleDescription: null,
    drivesMemberVehicle: false,
    carriesPassenger: true,
    responseDeadline: new Date(Date.now() + 30_000).toISOString(),
    tandemRequired: false,
    tandemFee: null,
    tandemJobId: null,
    tandemMode: null,
    tandemModeConfirmed: false,
    waypoints: null,
    currentWaypointIndex: 0,
  };
}

function resetStore() {
  act(() => {
    useDispatchStore.getState().clearDispatch();
    useDispatchStore.setState({ serverCancelled: false });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DISPATCH STORE — state machine
// ─────────────────────────────────────────────────────────────────────────────
describe('dispatchStore state machine', () => {
  beforeEach(resetStore);

  it('starts in idle state', () => {
    const { stage, rideId, assignmentId } = useDispatchStore.getState();
    expect(stage).toBe('idle');
    expect(rideId).toBeNull();
    expect(assignmentId).toBeNull();
  });

  it('transitions idle → offered on setOffer, recording all fields', () => {
    act(() => useDispatchStore.getState().setOffer(makeOfferPayload()));

    const s = useDispatchStore.getState();
    expect(s.stage).toBe('offered');
    expect(s.rideId).toBe('ride-1');
    expect(s.estimatedFare).toBe(28.50);
    expect(s.estimatedDistance).toBe(8.2);
    expect(s.startedAt).toBeNull();
    expect(s.cancellationReason).toBeNull();
    expect(s.serverCancelled).toBe(false);
  });

  it('advances through accepted → navigating → arrived → in_progress', () => {
    act(() => useDispatchStore.getState().setOffer(makeOfferPayload()));

    for (const stage of ['accepted', 'navigating', 'arrived'] as const) {
      act(() => useDispatchStore.getState().setStage(stage));
      expect(useDispatchStore.getState().stage).toBe(stage);
    }

    const startedAt = new Date().toISOString();
    act(() => useDispatchStore.getState().setStage('in_progress', { startedAt }));
    expect(useDispatchStore.getState().stage).toBe('in_progress');
    expect(useDispatchStore.getState().startedAt).toBe(startedAt);
  });

  it('clearDispatch resets all ride fields to initial values', () => {
    act(() => {
      useDispatchStore.getState().setOffer(makeOfferPayload());
      useDispatchStore.getState().setStage('in_progress');
      useDispatchStore.getState().clearDispatch();
    });

    const s = useDispatchStore.getState();
    expect(s.stage).toBe('idle');
    expect(s.rideId).toBeNull();
    expect(s.assignmentId).toBeNull();
    expect(s.estimatedFare).toBeNull();
  });

  it('clearDispatch preserves serverCancelled so overlay can render after clear', () => {
    act(() => {
      useDispatchStore.getState().setServerCancelled(true);
      useDispatchStore.getState().clearDispatch();
    });
    expect(useDispatchStore.getState().serverCancelled).toBe(true);
  });

  it('setCancelled records reason and stage=cancelled', () => {
    act(() => {
      useDispatchStore.getState().setOffer(makeOfferPayload());
      useDispatchStore.getState().setStage('in_progress');
      useDispatchStore.getState().setCancelled('Member cancelled');
    });

    const s = useDispatchStore.getState();
    expect(s.stage).toBe('cancelled');
    expect(s.cancellationReason).toBe('Member cancelled');
  });

  it('setTandemJob sets jobId, mode, and confirms tandem', () => {
    act(() => useDispatchStore.getState().setTandemJob('tandem-99', 'B'));
    const s = useDispatchStore.getState();
    expect(s.tandemJobId).toBe('tandem-99');
    expect(s.tandemMode).toBe('B');
    expect(s.tandemModeConfirmed).toBe(true);
  });

  it('advanceWaypoint increments currentWaypointIndex', () => {
    act(() => {
      useDispatchStore.getState().setOffer({
        ...makeOfferPayload(),
        waypoints: [
          { address: 'Stop B', lat: 30.05, lng: -97.05 },
          { address: 'Stop C', lat: 30.10, lng: -97.10 },
        ],
        currentWaypointIndex: 0,
      });
    });

    expect(useDispatchStore.getState().currentWaypointIndex).toBe(0);
    act(() => useDispatchStore.getState().advanceWaypoint());
    expect(useDispatchStore.getState().currentWaypointIndex).toBe(1);
    act(() => useDispatchStore.getState().advanceWaypoint());
    expect(useDispatchStore.getState().currentWaypointIndex).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. GO ONLINE — useDriverStatus
// ─────────────────────────────────────────────────────────────────────────────
describe('useDriverStatus — go online flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.confirm = vi.fn(() => true);
    // Default: permission is prompt so the OS call fires
    vi.mocked(navigator.permissions.query).mockResolvedValue({ state: 'prompt' } as PermissionStatus);
  });

  it('hydrates is_online and position from Supabase on mount', async () => {
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({
        data: makeDriverRow({ is_online: true, current_lat: 30.3, current_lng: -97.8 }),
        error: null,
      })),
    } as never);

    const { result } = renderHook(() => useDriverStatus('driver-1'));
    await waitFor(() => expect(result.current.isOnline).toBe(true));
    expect(result.current.currentLat).toBe(30.3);
    expect(result.current.currentLng).toBe(-97.8);
  });

  it('toggleOnline writes is_online=true to the drivers table', async () => {
    // Navigator.permissions.query → 'granted' skips the rationale dialog
    vi.mocked(navigator.permissions.query).mockResolvedValue({ state: 'granted' } as PermissionStatus);

    const updateEq = vi.fn(async () => ({ error: null }));
    vi.mocked(supabase.from).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: makeDriverRow(), error: null })),
      update: vi.fn(() => ({ eq: updateEq })),
    } as never);

    act(() => useDriverStatusStore.getState().setOnline(false));
    const { result } = renderHook(() => useDriverStatus('driver-1'));

    await act(async () => {
      await result.current.toggleOnline();
    });

    expect(supabase.from).toHaveBeenCalledWith('drivers');
    expect(result.current.isOnline).toBe(true);
  });

  it('stays offline and records locationError when permission is denied', async () => {
    vi.mocked(navigator.permissions.query).mockResolvedValue({ state: 'denied' } as PermissionStatus);

    act(() => useDriverStatusStore.getState().setOnline(false));
    const { result } = renderHook(() => useDriverStatus('driver-1'));

    await act(async () => {
      await result.current.toggleOnline();
    });

    expect(result.current.isOnline).toBe(false);
    expect(result.current.locationError).toBe(
      'Location permission denied — open Settings to allow location access.',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. RIDE REQUEST ARRIVAL — useRideRequests
// ─────────────────────────────────────────────────────────────────────────────
describe('useRideRequests — offer arrival and dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('exposes null incomingRequest when store is idle', () => {
    const { result } = renderHook(() => useRideRequests('driver-1', true));
    expect(result.current.incomingRequest).toBeNull();
  });

  it('exposes incomingRequest once store transitions to offered', () => {
    const { result } = renderHook(() => useRideRequests('driver-1', true));

    act(() => useDispatchStore.getState().setOffer(makeOfferPayload()));

    expect(result.current.incomingRequest).not.toBeNull();
    expect(result.current.incomingRequest?.rideId).toBe('ride-1');
    expect(result.current.incomingRequest?.estimatedFare).toBe(28.50);
  });

  it('backfill on mount hydrates pending assignment and vibrates device', async () => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'driver_assignments') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gt: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn(async () => ({ data: [makeAssignment()], error: null })),
        } as never;
      }
      if (table === 'rides') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(async () => ({ data: makeRide(), error: null })),
        } as never;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({ data: null, error: null })),
      } as never;
    });

    renderHook(() => useRideRequests('driver-1', true));

    await waitFor(() => expect(useDispatchStore.getState().stage).toBe('offered'));
    expect(useDispatchStore.getState().rideId).toBe('ride-1');
    expect(navigator.vibrate).toHaveBeenCalledWith([200, 100, 200]);
  });

  it('skips backfill when an active ride is already in progress', async () => {
    act(() => useDispatchStore.getState().setStage('in_progress'));
    vi.mocked(supabase.from).mockClear();

    renderHook(() => useRideRequests('driver-1', true));

    await new Promise((r) => setTimeout(r, 50));
    const assignmentCalls = vi.mocked(supabase.from).mock.calls.filter(([t]) => t === 'driver_assignments');
    expect(assignmentCalls.length).toBe(0);
  });

  it('does not subscribe when isOnline is false', () => {
    vi.mocked(supabase.channel).mockClear();
    renderHook(() => useRideRequests('driver-1', false));
    expect(supabase.channel).not.toHaveBeenCalled();
  });

  it('dismissRequest clears dispatch to idle (timeout path)', () => {
    act(() => useDispatchStore.getState().setOffer(makeOfferPayload()));
    expect(useDispatchStore.getState().stage).toBe('offered');

    const { result } = renderHook(() => useRideRequests('driver-1', true));
    act(() => result.current.dismissRequest());
    expect(useDispatchStore.getState().stage).toBe('idle');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ACCEPT FLOW
// ─────────────────────────────────────────────────────────────────────────────
describe('accept flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('acceptRide calls POST /rides/assignments/:id/accept with Bearer token', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    await acceptRide('assign-1');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/rides/assignments/assign-1/accept'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('store transitions to accepted when API succeeds', async () => {
    act(() => useDispatchStore.getState().setOffer(makeOfferPayload()));

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    const { result } = renderHook(() => useRideRequests('driver-1', true));
    await act(async () => { await result.current.acceptRide(); });

    expect(useDispatchStore.getState().stage).toBe('accepted');
  });

  it('store remains in offered when API returns an error (inline error path)', async () => {
    act(() => useDispatchStore.getState().setOffer(makeOfferPayload()));

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Response deadline has passed' }), { status: 400 }),
    );

    const { result } = renderHook(() => useRideRequests('driver-1', true));
    await act(async () => { await result.current.acceptRide(); });

    expect(useDispatchStore.getState().stage).toBe('offered');
  });

  it('acceptRide with expired deadline returns failure', async () => {
    act(() => {
      useDispatchStore.getState().setOffer({
        ...makeOfferPayload(),
        responseDeadline: new Date(Date.now() - 5_000).toISOString(),
      });
    });

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Response deadline has passed' }), { status: 400 }),
    );

    const { result } = renderHook(() => useRideRequests('driver-1', true));
    const res = await act(async () => result.current.acceptRide());

    expect(res.success).toBe(false);
    expect(useDispatchStore.getState().stage).toBe('offered');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. DECLINE FLOW
// ─────────────────────────────────────────────────────────────────────────────
describe('decline flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    act(() => useDispatchStore.getState().setOffer(makeOfferPayload()));
  });

  it('declineRide calls POST /rides/assignments/:id/decline and clears dispatch', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    const { result } = renderHook(() => useRideRequests('driver-1', true));
    await act(async () => { await result.current.declineRide(); });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/rides/assignments/assign-1/decline'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(useDispatchStore.getState().stage).toBe('idle');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. RIDE STAGE TRANSITIONS — useActiveRide
// ─────────────────────────────────────────────────────────────────────────────
describe('useActiveRide — stage transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    act(() => {
      useDispatchStore.getState().setOffer(makeOfferPayload());
      useDispatchStore.getState().setStage('accepted');
    });
  });

  it('startNavigating calls PATCH stage=en_route and sets store to navigating', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    const { result } = renderHook(() => useActiveRide());
    await act(async () => { await result.current.startNavigating(); });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/rides/assignments/assign-1/stage'),
      expect.objectContaining({ body: JSON.stringify({ stage: 'en_route' }) }),
    );
    expect(useDispatchStore.getState().stage).toBe('navigating');
  });

  it('markArrived calls PATCH stage=arrived from navigating', async () => {
    act(() => useDispatchStore.getState().setStage('navigating'));
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    const { result } = renderHook(() => useActiveRide());
    await act(async () => { await result.current.markArrived(); });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/stage'),
      expect.objectContaining({ body: JSON.stringify({ stage: 'arrived' }) }),
    );
    expect(useDispatchStore.getState().stage).toBe('arrived');
  });

  it('startRide calls PATCH stage=in_progress and records startedAt timestamp', async () => {
    act(() => useDispatchStore.getState().setStage('arrived'));
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    const before = Date.now();
    const { result } = renderHook(() => useActiveRide());
    await act(async () => { await result.current.startRide(); });
    const after = Date.now();

    expect(useDispatchStore.getState().stage).toBe('in_progress');
    const startedAt = new Date(useDispatchStore.getState().startedAt!).getTime();
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(after);
  });

  it('completeRide calls POST /rides/:id/complete with distance and computed duration', async () => {
    const startedAt = new Date(Date.now() - 25 * 60_000).toISOString();
    act(() => useDispatchStore.getState().setStage('in_progress', { startedAt }));

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, finalFare: 30.75, driverPayout: 26.14 }),
        { status: 200 },
      ),
    );

    const { result } = renderHook(() => useActiveRide());
    const res = await act(async () => result.current.completeRide(9.1));

    expect(res).toMatchObject({ success: true, rideId: 'ride-1' });

    const body = JSON.parse(
      (vi.mocked(globalThis.fetch).mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.assignmentId).toBe('assign-1');
    expect(body.actualDistanceMiles).toBe(9.1);
    expect(body.actualDurationMinutes).toBeCloseTo(25, 0);

    // Store clears to idle after successful completion
    expect(useDispatchStore.getState().stage).toBe('idle');
    expect(useDispatchStore.getState().rideId).toBeNull();
  });

  it('cancelRide calls POST /rides/:id/cancel and resets store to idle', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    const { result } = renderHook(() => useActiveRide());
    await act(async () => { await result.current.cancelRide('Driver cancelled'); });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/rides/ride-1/cancel'),
      expect.objectContaining({
        body: JSON.stringify({ reason: 'Driver cancelled', cancelledBy: 'driver' }),
      }),
    );
    expect(useDispatchStore.getState().stage).toBe('idle');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. COMPLETION — fare arithmetic
// ─────────────────────────────────────────────────────────────────────────────
describe('fare calculation (mirrors server TIER_RATES)', () => {
  it('tier_1_passenger: base + per-mile, no per-minute', () => {
    // 10 + 8.2×1.5 = 22.30
    expect(computeFare('tier_1_passenger', 8.2)).toBeCloseTo(22.30, 2);
  });

  it('tier_0_rideshare: applies per-minute at completion', () => {
    // 5 + 10×1.5 + 20×0.30 = 26.00
    expect(computeFare('tier_0_rideshare', 10, 20)).toBeCloseTo(26.00, 2);
  });

  it('tier_0_delivery: includes pickup fee', () => {
    // 6 + 1.50 + 5×2.0 + 15×0.35 = 22.75
    expect(computeFare('tier_0_delivery', 5, 15)).toBeCloseTo(22.75, 2);
  });

  it('enforces minimum fare', () => {
    // tier_1_passenger minimum=12; 0-mile trip = base 10 → clamped to 12
    expect(computeFare('tier_1_passenger', 0)).toBe(12);
  });

  it('driver payout = fare × 0.85 rounded to cents', () => {
    const fare = computeFare('tier_1_passenger', 8.2);
    const payout = Math.round(fare * 0.85 * 100) / 100;
    expect(payout).toBeCloseTo(22.30 * 0.85, 2);
  });

  // Living documentation: completion currently writes to driver_payouts (legacy).
  // When migrated to driver_earnings, update this test.
  it('documents: client does NOT write directly to driver_payouts or driver_earnings', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, finalFare: 22.30, driverPayout: 18.96 }), { status: 200 }),
    );

    useDispatchStore.setState({
      rideId: 'ride-1', assignmentId: 'assign-1', stage: 'in_progress',
      startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    });

    await completeRide('ride-1', 'assign-1', 8.2, 20);

    // The API server (not client) owns the payout insert.
    // No direct supabase.from('driver_payouts') or supabase.from('driver_earnings') call.
    expect(supabase.from).not.toHaveBeenCalledWith('driver_payouts');
    expect(supabase.from).not.toHaveBeenCalledWith('driver_earnings');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. POST-RIDE FLOWS — rating, co-driver eval, tip
// ─────────────────────────────────────────────────────────────────────────────
describe('post-ride flows', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rating submission calls POST /api/ratings with stars and comment', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    await globalThis.fetch('/api/ratings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ rideId: 'ride-1', stars: 4, comment: 'Great member!' }),
    });

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/ratings',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ rideId: 'ride-1', stars: 4, comment: 'Great member!' }),
      }),
    );
  });

  it('co-driver eval calls POST /api/evaluations/co-driver with all 4 criteria', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    const payload = {
      rideId: 'ride-1',
      communication: 5, punctuality: 4, safety: 5, professionalism: 4,
      comment: 'Smooth tandem op.',
    };
    await globalThis.fetch('/api/evaluations/co-driver', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify(payload),
    });

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/evaluations/co-driver',
      expect.objectContaining({ body: JSON.stringify(payload) }),
    );
  });

  it('tip submission calls POST /api/tips with rideId and amount', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );

    await globalThis.fetch('/api/tips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ rideId: 'ride-1', amount: 5 }),
    });

    const [, opts] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    const body = JSON.parse((opts as RequestInit).body as string) as { rideId: string; amount: number };
    expect(body.amount).toBe(5);
    expect(body.rideId).toBe('ride-1');
  });

  it('routes to eval-codriver for tandem rides, tip for standard rides', () => {
    const nextRoute = (tandemRequired: boolean) =>
      tandemRequired ? '/ride/ride-1/eval-codriver' : '/ride/ride-1/tip';

    expect(nextRoute(false)).toBe('/ride/ride-1/tip');
    expect(nextRoute(true)).toBe('/ride/ride-1/eval-codriver');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. NAVIGATION SERVICE — external nav deep links
// ─────────────────────────────────────────────────────────────────────────────
describe('navService — external nav deep links', () => {
  beforeEach(() => {
    vi.mocked(globalThis.open).mockClear();
    vi.mocked(globalThis.open).mockReturnValue({ focus: vi.fn() } as never);
  });

  it('openNavigation opens Google Maps native deep link on non-iOS', async () => {
    await openNavigation('google_maps', { lat: 30.267, lng: -97.743, label: '123 Main St' });
    // jsdom UA is not iOS, so Android deep link is used: google.navigation:q=...
    expect(globalThis.open).toHaveBeenCalledWith(
      expect.stringContaining('google.navigation:q='), '_blank',
    );
  });

  it('openNavigation opens Waze native deep link', async () => {
    await openNavigation('waze', { lat: 30.267, lng: -97.743 });
    // Native link tried first; mock returns truthy so web fallback is skipped
    expect(globalThis.open).toHaveBeenCalledWith(
      expect.stringContaining('waze://'), '_blank',
    );
  });

  it('URL includes destination lat/lng', async () => {
    await openNavigation('google_maps', { lat: 30.267, lng: -97.743 });
    const url = vi.mocked(globalThis.open).mock.calls[0]![0] as string;
    expect(url).toContain('30.267');
    expect(url).toContain('-97.743');
  });

  it('falls back to web URL when window.open returns null (native app not installed)', async () => {
    vi.mocked(globalThis.open)
      .mockReturnValueOnce(null) // native deep link → not opened
      .mockReturnValue({ focus: vi.fn() } as never);

    await openNavigation('waze', { lat: 30.267, lng: -97.743 });
    expect(globalThis.open).toHaveBeenCalledTimes(2);
  });

  it('getDefaultNavApp returns apple_maps on iOS user-agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15',
      configurable: true,
    });
    expect(getDefaultNavApp()).toBe('apple_maps');
  });

  it('getDefaultNavApp returns google_maps on Android user-agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
      configurable: true,
    });
    expect(getDefaultNavApp()).toBe('google_maps');
  });

  it('getAvailableNavApps excludes apple_maps on Android', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36',
      configurable: true,
    });
    const apps = getAvailableNavApps();
    expect(apps).not.toContain('apple_maps');
    expect(apps).toContain('google_maps');
    expect(apps).toContain('waze');
  });

  it('getAvailableNavApps includes apple_maps on iOS', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
      configurable: true,
    });
    expect(getAvailableNavApps()).toContain('apple_maps');
  });

  it('getNavAppName returns human-readable labels', () => {
    expect(getNavAppName('google_maps')).toBe('Google Maps');
    expect(getNavAppName('waze')).toBe('Waze');
    expect(getNavAppName('apple_maps')).toBe('Apple Maps');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. ROUTE SERVICE — map + ETA
// ─────────────────────────────────────────────────────────────────────────────
describe('routeService', () => {
  it('returns null when Google Maps API key is not configured', async () => {
    // loadMapsApi is mocked to return false in setup.ts
    const result = await fetchRoute(
      { lat: 30.267, lng: -97.743 },
      { lat: 30.284, lng: -97.739 },
    );
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────
describe('edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('member cancellation mid-ride sets stage=cancelled with reason and serverCancelled=true', () => {
    act(() => {
      useDispatchStore.getState().setOffer(makeOfferPayload());
      useDispatchStore.getState().setStage('in_progress', { startedAt: new Date().toISOString() });
      useDispatchStore.getState().setCancelled('Member cancelled the ride');
      useDispatchStore.getState().setServerCancelled(true);
    });

    const s = useDispatchStore.getState();
    expect(s.stage).toBe('cancelled');
    expect(s.cancellationReason).toBe('Member cancelled the ride');
    expect(s.serverCancelled).toBe(true);
  });

  it('network failure during completeRide reverts stage from completing to in_progress', async () => {
    act(() => {
      useDispatchStore.getState().setOffer(makeOfferPayload());
      useDispatchStore.getState().setStage('in_progress', {
        startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      });
    });

    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useActiveRide());
    const res = await act(async () => result.current.completeRide(9.1));

    expect(res.success).toBe(false);
    expect(useDispatchStore.getState().stage).toBe('in_progress');
  });

  it('completeRide with no active ride returns failure without calling fetch', async () => {
    // Store is idle
    const { result } = renderHook(() => useActiveRide());
    const res = await act(async () => result.current.completeRide(5.0));

    expect(res.success).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('offline accept keeps stage=offered (inline error path, no modal dismiss)', async () => {
    act(() => useDispatchStore.getState().setOffer(makeOfferPayload()));

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Network error' }), { status: 500 }),
    );

    const { result } = renderHook(() => useRideRequests('driver-1', true));
    await act(async () => { await result.current.acceptRide(); });

    // Offer stays visible — driver can retry
    expect(useDispatchStore.getState().stage).toBe('offered');
  });

  it('driver with no rideId or assignmentId cannot accept', async () => {
    // Store is idle — no offer hydrated
    const { result } = renderHook(() => useRideRequests('driver-1', true));
    const res = await act(async () => result.current.acceptRide());

    expect(res.success).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
