// ============================================================
// MCC Driver — Logout Flow Tests
// ============================================================
// Covers useAuth.signOut behaviour:
//   - sets is_online = false before clearing session
//   - clears local auth state on success
//   - clears local auth state even when supabase.auth.signOut() throws (network failure)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { supabase } from '@/services/supabase/client';
import type { DriverProfile } from '@/store/authStore';

vi.mock('@/services/push/registerPush', () => ({
  unregisterPushSubscription: vi.fn(async () => {}),
  registerPushSubscription:   vi.fn(async () => {}),
}));

vi.mock('@/services/push/registerNativePush', () => ({
  unregisterNativePush: vi.fn(async () => {}),
  registerNativePush:   vi.fn(async () => {}),
}));

vi.mock('@/services/telemetry/sentry', () => ({
  setSentryUser: vi.fn(),
}));

const DRIVER: DriverProfile = {
  id: 'driver-1',
  userId: 'user-1',
  firstName: 'App',
  lastName: 'Reviewer',
  email: 'test@example.com',
  phone: '+15555550199',
  status: 'active',
  isOnline: true,
  canDriveMemberVehicle: true,
  canDoRideshare: true,
  canDoDelivery: true,
  totalRidesCompleted: 47,
  averageRating: 4.9,
  completionRate: 0.98,
  backgroundCheckPassed: true,
  bgcStatus: 'passed',
};

function seedStore() {
  const { setSession, setDriver } = useAuthStore.getState();
  setSession({ access_token: 'tok', user: { id: 'user-1' } } as never);
  setDriver(DRIVER);
}

function resetStore() {
  useAuthStore.getState().clear();
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  // Restore default: signOut succeeds
  vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null } as never);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getFromMock() {
  return vi.mocked(supabase.from);
}

describe('useAuth.signOut', () => {
  it('sets is_online=false on the drivers row before clearing', async () => {
    seedStore();
    const updateMock = vi.fn().mockReturnThis();
    const eqMock = vi.fn().mockReturnThis();
    const catchMock = vi.fn().mockResolvedValue(undefined);
    getFromMock().mockReturnValue({
      update: updateMock,
      eq: eqMock,
      catch: catchMock,
    } as never);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signOut();
    });

    expect(getFromMock()).toHaveBeenCalledWith('drivers');
    expect(updateMock).toHaveBeenCalledWith({ is_online: false });
    expect(eqMock).toHaveBeenCalledWith('id', DRIVER.id);
  });

  it('clears auth store state after successful signOut', async () => {
    seedStore();
    expect(useAuthStore.getState().driver).not.toBeNull();
    expect(useAuthStore.getState().session).not.toBeNull();

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signOut();
    });

    expect(vi.mocked(supabase.auth.signOut)).toHaveBeenCalledOnce();
    const state = useAuthStore.getState();
    expect(state.driver).toBeNull();
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
  });

  it('clears auth store state even when supabase.auth.signOut throws (network failure)', async () => {
    seedStore();
    vi.mocked(supabase.auth.signOut).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signOut();
    });

    // Must not throw — error is swallowed internally
    const state = useAuthStore.getState();
    expect(state.driver).toBeNull();
    expect(state.session).toBeNull();
    expect(state.user).toBeNull();
  });

  it('still clears local state when no driver row exists', async () => {
    // No driver in store (e.g. user navigated away before hydration finished)
    useAuthStore.getState().setSession({ access_token: 'tok', user: { id: 'user-1' } } as never);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.signOut();
    });

    // Should not attempt an is_online=false update with no driver
    expect(getFromMock()).not.toHaveBeenCalledWith('drivers');
    expect(useAuthStore.getState().session).toBeNull();
  });
});
