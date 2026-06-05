import { describe, it, expect } from 'vitest';
import {
  createProgress,
  recordAngle,
  remainingAngles,
  isComplete,
  canCompleteHandoff,
  ALL_PHOTO_ANGLES,
} from './captureProgress';
import { FULL_ANGLE_SET, type PhotoAngle } from './custody.types';

// ── state machine ──────────────────────────────────────────────────────────

describe('captureProgress state machine', () => {
  it('all angles remain when nothing is captured', () => {
    const state = createProgress();
    expect(remainingAngles(state, FULL_ANGLE_SET)).toEqual(FULL_ANGLE_SET);
    expect(isComplete(state, FULL_ANGLE_SET)).toBe(false);
    expect(canCompleteHandoff(state, FULL_ANGLE_SET)).toBe(false);
  });

  it('remaining decreases as angles are captured and passed', () => {
    let state = createProgress();
    state = recordAngle(state, 'front', { passed: true });
    state = recordAngle(state, 'rear',  { passed: true });
    const remaining = remainingAngles(state, FULL_ANGLE_SET);
    expect(remaining).not.toContain('front');
    expect(remaining).not.toContain('rear');
    expect(remaining).toHaveLength(FULL_ANGLE_SET.length - 2);
    expect(isComplete(state, FULL_ANGLE_SET)).toBe(false);
  });

  it('a captured-but-failed angle does NOT count toward completeness', () => {
    let state = createProgress();
    state = recordAngle(state, 'front', { passed: false });
    expect(remainingAngles(state, FULL_ANGLE_SET)).toContain('front');
    expect(isComplete(state, FULL_ANGLE_SET)).toBe(false);
    expect(canCompleteHandoff(state, FULL_ANGLE_SET)).toBe(false);
  });

  it('isComplete and canCompleteHandoff when all required angles pass', () => {
    let state = createProgress();
    for (const angle of FULL_ANGLE_SET) {
      state = recordAngle(state, angle, { passed: true });
    }
    expect(remainingAngles(state, FULL_ANGLE_SET)).toEqual([]);
    expect(isComplete(state, FULL_ANGLE_SET)).toBe(true);
    expect(canCompleteHandoff(state, FULL_ANGLE_SET)).toBe(true);
  });

  it('re-capturing replaces the prior result (failed → passed clears remaining)', () => {
    let state = createProgress();
    state = recordAngle(state, 'front', { passed: false });
    expect(remainingAngles(state, FULL_ANGLE_SET)).toContain('front');
    state = recordAngle(state, 'front', { passed: true });
    expect(remainingAngles(state, FULL_ANGLE_SET)).not.toContain('front');
  });

  it('re-capturing replaces the prior result (passed → failed restores remaining)', () => {
    let state = createProgress();
    state = recordAngle(state, 'front', { passed: true });
    expect(remainingAngles(state, FULL_ANGLE_SET)).not.toContain('front');
    state = recordAngle(state, 'front', { passed: false });
    expect(remainingAngles(state, FULL_ANGLE_SET)).toContain('front');
  });

  it('an extra angle outside the required set is ignored for completeness', () => {
    const required: PhotoAngle[] = ['front', 'rear'];
    let state = createProgress();
    state = recordAngle(state, 'front', { passed: true });
    state = recordAngle(state, 'rear',  { passed: true });
    state = recordAngle(state, 'other', { passed: true }); // not in required
    expect(isComplete(state, required)).toBe(true);
    expect(remainingAngles(state, required)).toEqual([]);
  });

  it('canCompleteHandoff uses the provided required set, not FULL_ANGLE_SET', () => {
    const required: PhotoAngle[] = ['front', 'rear'];
    let state = createProgress();
    state = recordAngle(state, 'front', { passed: true });
    expect(canCompleteHandoff(state, required)).toBe(false);
    state = recordAngle(state, 'rear', { passed: true });
    expect(canCompleteHandoff(state, required)).toBe(true);
  });

  it('quality_meta is stored and accessible on the result', () => {
    let state = createProgress();
    const meta = { blur: 0.92, brightness: 0.55, edgeDensity: 0.31 };
    state = recordAngle(state, 'front', { passed: true, meta });
    expect(state.get('front')?.meta).toEqual(meta);
  });
});

// ── angle manifest validation ──────────────────────────────────────────────

describe('angle manifest', () => {
  it('FULL_ANGLE_SET has no duplicate values', () => {
    const seen = new Set<string>();
    for (const a of FULL_ANGLE_SET) {
      expect(seen.has(a), `duplicate angle: ${a}`).toBe(false);
      seen.add(a);
    }
  });

  it('every value in FULL_ANGLE_SET is a known PhotoAngle', () => {
    const valid = new Set<string>(ALL_PHOTO_ANGLES);
    for (const a of FULL_ANGLE_SET) {
      expect(valid.has(a), `unknown angle in FULL_ANGLE_SET: ${a}`).toBe(true);
    }
  });

  it('ALL_PHOTO_ANGLES has no duplicate values', () => {
    const seen = new Set<string>();
    for (const a of ALL_PHOTO_ANGLES) {
      expect(seen.has(a), `duplicate in ALL_PHOTO_ANGLES: ${a}`).toBe(false);
      seen.add(a);
    }
  });
});
