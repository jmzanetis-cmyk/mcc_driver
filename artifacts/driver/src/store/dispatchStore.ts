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
  | 'completed';    // Done (transient, clears after review)

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

  // Actions
  setOffer: (payload: Omit<DispatchState, 'stage' | 'startedAt' | 'setOffer' | 'setStage' | 'clearDispatch'>) => void;
  setStage: (stage: DispatchStage, extra?: Partial<DispatchState>) => void;
  clearDispatch: () => void;
}

const INITIAL: Pick<DispatchState, 'rideId' | 'assignmentId' | 'stage' | 'role' | 'scenario' | 'tier' | 'pickupAddress' | 'pickupLat' | 'pickupLng' | 'dropoffAddress' | 'dropoffLat' | 'dropoffLng' | 'estimatedFare' | 'estimatedDistance' | 'memberVehicleDescription' | 'drivesMemberVehicle' | 'carriesPassenger' | 'responseDeadline' | 'startedAt'> = {
  rideId: null,
  assignmentId: null,
  stage: 'idle',
  role: null,
  scenario: null,
  tier: null,
  pickupAddress: null,
  pickupLat: null,
  pickupLng: null,
  dropoffAddress: null,
  dropoffLat: null,
  dropoffLng: null,
  estimatedFare: null,
  estimatedDistance: null,
  memberVehicleDescription: null,
  drivesMemberVehicle: false,
  carriesPassenger: false,
  responseDeadline: null,
  startedAt: null,
};

export const useDispatchStore = create<DispatchState>((set) => ({
  ...INITIAL,

  setOffer: (payload) => set({ ...payload, stage: 'offered', startedAt: null }),

  setStage: (stage, extra) => set((s) => ({ ...s, stage, ...extra })),

  clearDispatch: () => set(INITIAL),
}));
