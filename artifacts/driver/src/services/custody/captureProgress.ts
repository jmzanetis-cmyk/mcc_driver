// Completeness enforcement state machine for guided custody capture.
// Pure functions — no I/O, no Capacitor, no side effects.
// Import FULL_ANGLE_SET from custody.types to drive the required set.

import type { PhotoAngle } from './custody.types';

export interface AngleResult {
  passed: boolean;
  meta?: Record<string, unknown>;
}

// Immutable snapshot of per-angle capture results.
export type ProgressState = ReadonlyMap<PhotoAngle, AngleResult>;

// Runtime list of every valid PhotoAngle value — use in tests to validate
// the manifest, and in UI dropdowns that need exhaustive coverage.
export const ALL_PHOTO_ANGLES: readonly PhotoAngle[] = [
  'front', 'rear', 'driver_side', 'passenger_side', 'roof',
  'wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr',
  'interior_front', 'interior_rear', 'cargo', 'odometer', 'fuel_gauge', 'other',
];

export function createProgress(): ProgressState {
  return new Map();
}

// Returns a new state with the angle recorded (replaces any prior result).
export function recordAngle(
  state: ProgressState,
  angle: PhotoAngle,
  result: AngleResult,
): ProgressState {
  const next = new Map(state);
  next.set(angle, result);
  return next;
}

// Angles in `required` that are not yet captured with passed === true.
export function remainingAngles(
  state: ProgressState,
  required: readonly PhotoAngle[],
): PhotoAngle[] {
  return required.filter(a => {
    const r = state.get(a);
    return !r || !r.passed;
  });
}

// True only when every angle in `required` has been captured and passed.
export function isComplete(
  state: ProgressState,
  required: readonly PhotoAngle[],
): boolean {
  return remainingAngles(state, required).length === 0;
}

// Gate for the release/accept action. Extra angles beyond the required set
// are recorded in state but have no effect on this check.
export function canCompleteHandoff(
  state: ProgressState,
  required: readonly PhotoAngle[],
): boolean {
  return isComplete(state, required);
}
