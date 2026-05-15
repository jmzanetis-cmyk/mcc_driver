// ============================================================
// MCC Driver — Dispatch Store (Zustand)
// ============================================================
// Manages the current ride/assignment state globally.
// Replaces the old useActiveRide hook's local state.
// ============================================================

import { create } from 'zustand';

export type DispatchStage =
  | 'idle'
  | 'offered'       // Ride request received, countdown running
  | 'accepted'      // Driver accepted, hasn't started navigating
  | 'navigating'    // Heading to pickup
  | 'arrived'       // At pickup location
  | 'in_progress'   // Ride underway
  | 'completing'    // Processing completion
  | 'completed'     // Done (transient, clears after review)
  | 'cancelled';    // Ride cancelled externally (member/admin) after acceptance

interface DispatchState {
  rideId: string | null;
  assignmentId: string | null;
  stage: DispatchStage;
  role: 'primary' | 'chase' | null;
  scenario: string | null;
  tier: string | null;
  pickupAddress: string | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffAddress: string | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
  estimatedFare: number | null;
  estimatedDistance: number | null;
  memberVehicleDescription: string | null;
  drivesMemberVehicle: boolean;
  carriesPassenger: boolean;
  responseDeadline: string | null;
  startedAt: string | null;
  cancellationReason: string | null;

  // Actions
  setOffer: (payload: Omit<DispatchState, 'stage' | 'startedAt' | 'cancellationReason' | 'setOffer' | 'setStage' | 'setCancelled' | 'clearDispatch'>) => void;
  setStage: (stage: DispatchStage, extra?: Partial<DispatchState>) => void;
  setCancelled: (reason?: string) => void;
  clearDispatch: () => void;
}

const INITIAL = {
  rideId: null as string | null,
  assignmentId: null as string | null,
  stage: 'idle' as DispatchStage,
  role: null as 'primary' | 'chase' | null,
  scenario: null as string | null,
  tier: null as string | null,
  pickupAddress: null as string | null,
  pickupLat: null as number | null,
  pickupLng: null as number | null,
  dropoffAddress: null as string | null,
  dropoffLat: null as number | null,
  dropoffLng: null as number | null,
  estimatedFare: null as number | null,
  estimatedDistance: null as number | null,
  memberVehicleDescription: null as string | null,
  drivesMemberVehicle: false,
  carriesPassenger: false,
  responseDeadline: null as string | null,
  startedAt: null as string | null,
  cancellationReason: null as string | null,
};

export const useDispatchStore = create<DispatchState>((set) => ({
  ...INITIAL,

  setOffer: (payload) => set({ ...payload, stage: 'offered', startedAt: null, cancellationReason: null }),

  setStage: (stage, extra) => set((s) => ({ ...s, stage, ...extra })),

  setCancelled: (reason) => set((s) => ({ ...s, stage: 'cancelled', cancellationReason: reason ?? null })),

  clearDispatch: () => set(INITIAL),
}));
