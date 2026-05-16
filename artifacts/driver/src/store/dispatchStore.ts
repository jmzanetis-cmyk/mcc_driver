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
  serviceType: 'rideshare' | 'delivery' | 'concierge';
  packageDescription: string | null;
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

  // Tandem job fields (Phase 2+)
  tandemRequired: boolean;
  tandemFee: number | null;
  tandemJobId: string | null;
  tandemMode: 'A' | 'B' | 'C' | null;
  tandemModeConfirmed: boolean;

  // Set when the server/member/admin cancels an accepted ride — intentionally
  // NOT reset by clearDispatch so the UI can show a notification after state clears.
  serverCancelled: boolean;

  // Actions
  setOffer: (payload: Omit<DispatchState, 'stage' | 'startedAt' | 'cancellationReason' | 'serverCancelled' | 'setOffer' | 'setStage' | 'setCancelled' | 'clearDispatch' | 'setServerCancelled' | 'setTandemJob'>) => void;
  setStage: (stage: DispatchStage, extra?: Partial<DispatchState>) => void;
  setCancelled: (reason?: string) => void;
  clearDispatch: () => void;
  setServerCancelled: (value: boolean) => void;
  setTandemJob: (tandemJobId: string, tandemMode: 'A' | 'B' | 'C') => void;
}

const INITIAL = {
  rideId: null as string | null,
  assignmentId: null as string | null,
  stage: 'idle' as DispatchStage,
  role: null as 'primary' | 'chase' | null,
  scenario: null as string | null,
  tier: null as string | null,
  serviceType: 'concierge' as 'rideshare' | 'delivery' | 'concierge',
  packageDescription: null as string | null,
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
  tandemRequired: false,
  tandemFee: null as number | null,
  tandemJobId: null as string | null,
  tandemMode: null as 'A' | 'B' | 'C' | null,
  tandemModeConfirmed: false,
};

export const useDispatchStore = create<DispatchState>((set) => ({
  ...INITIAL,
  serverCancelled: false,

  setOffer: (payload) => set({ ...payload, stage: 'offered', startedAt: null, cancellationReason: null, serverCancelled: false }),

  setStage: (stage, extra) => set((s) => ({ ...s, stage, ...extra })),

  setCancelled: (reason) => set((s) => ({ ...s, stage: 'cancelled', cancellationReason: reason ?? null })),

  // serverCancelled is intentionally preserved across clearDispatch
  clearDispatch: () => set(INITIAL),

  setServerCancelled: (value) => set({ serverCancelled: value }),

  setTandemJob: (tandemJobId, tandemMode) => set({ tandemJobId, tandemMode, tandemModeConfirmed: true }),
}));
