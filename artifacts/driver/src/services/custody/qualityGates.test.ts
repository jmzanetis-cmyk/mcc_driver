import { describe, it, expect } from 'vitest';
import {
  CONSTANTS,
  blurCheck,
  exposureCheck,
  inFrameCheck,
  runQualityGates,
} from './qualityGates';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

interface ImageLike { data: Uint8ClampedArray; width: number; height: number; }

function makeImage(
  width: number,
  height: number,
  fill: (x: number, y: number) => number,
): ImageLike {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.round(fill(x, y));
      const i = (y * width + x) * 4;
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const SIZE = 16;
const HALF = SIZE / 2;

// All pixels identical → zero Laplacian variance, zero Sobel edges.
const flat128 = makeImage(SIZE, SIZE, () => 128);

// Pure black / white — extreme exposure failures.
const allBlack = makeImage(SIZE, SIZE, () => 0);
const allWhite = makeImage(SIZE, SIZE, () => 255);

// Step edge (left half 80, right half 175): contiguous edge detected by Sobel,
// non-zero Laplacian at the boundary, and balanced mean ≈ 127.5 (no clipping).
// ALL THREE GATES PASS.
const stepEdge80_175 = makeImage(SIZE, SIZE, (x) => x < HALF ? 80 : 175);

// Checkerboard 80/175: Laplacian variance is enormous (high-frequency alternation),
// but the Sobel 3×3 kernel sums to zero on every interior pixel — so inFrame fails.
// blur: PASS  |  exposure: PASS  |  inFrame: FAIL
const checkerboard80_175 = makeImage(SIZE, SIZE, (x, y) => (x + y) % 2 === 0 ? 80 : 175);

// ─── blurCheck ────────────────────────────────────────────────────────────────

describe('blurCheck', () => {
  it('passes for step-edge image — Laplacian variance well above threshold', () => {
    const r = blurCheck(stepEdge80_175);
    expect(r.passed).toBe(true);
    expect(r.blurVariance).toBeGreaterThan(CONSTANTS.BLUR_VARIANCE_THRESHOLD);
    expect(r.score).toBeGreaterThan(0);
    expect(r.reason).toBeUndefined();
  });

  it('passes for checkerboard — maximum high-frequency content', () => {
    const r = blurCheck(checkerboard80_175);
    expect(r.passed).toBe(true);
    // Checkerboard Laplacian: each pixel surrounded by ±95 difference → variance ~144 000
    expect(r.blurVariance).toBeGreaterThan(1000);
  });

  it('fails for flat gray — zero Laplacian variance', () => {
    const r = blurCheck(flat128);
    expect(r.passed).toBe(false);
    expect(r.blurVariance).toBe(0);
    expect(r.score).toBe(0);
    expect(r.reason).toMatch(/blur|focus/i);
  });

  it('fails for all-black image', () => {
    const r = blurCheck(allBlack);
    expect(r.passed).toBe(false);
    expect(r.blurVariance).toBe(0);
  });

  it('fails for all-white image', () => {
    const r = blurCheck(allWhite);
    expect(r.passed).toBe(false);
    expect(r.blurVariance).toBe(0);
  });
});

// ─── exposureCheck ────────────────────────────────────────────────────────────

describe('exposureCheck', () => {
  it('passes for flat gray 128 — mean squarely in range, no clipping', () => {
    const r = exposureCheck(flat128);
    expect(r.passed).toBe(true);
    expect(r.meanLuminance).toBeCloseTo(128, 0);
    expect(r.shadowRatio).toBe(0);
    expect(r.highlightRatio).toBe(0);
    expect(r.score).toBeGreaterThan(0.9);
  });

  it('passes for step-edge 80/175 — balanced mean, both halves within safe range', () => {
    const r = exposureCheck(stepEdge80_175);
    expect(r.passed).toBe(true);
    // mean = (80+175)/2 = 127.5
    expect(r.meanLuminance).toBeCloseTo(127.5, 0);
  });

  it('fails for all-black — mean below EXPOSURE_MIN_MEAN', () => {
    const r = exposureCheck(allBlack);
    expect(r.passed).toBe(false);
    expect(r.meanLuminance).toBe(0);
    expect(r.reason).toMatch(/dark/i);
  });

  it('fails for all-white — mean above EXPOSURE_MAX_MEAN', () => {
    const r = exposureCheck(allWhite);
    expect(r.passed).toBe(false);
    expect(r.meanLuminance).toBe(255);
    expect(r.reason).toMatch(/bright/i);
  });

  it('fails when shadow clipping ratio exceeds EXPOSURE_SHADOW_MAX_RATIO', () => {
    // 50% pixels = 0 (well below shadow clamp of 20), 50% = 200
    const mixed = makeImage(SIZE, SIZE, (x) => x < HALF ? 0 : 200);
    const r = exposureCheck(mixed);
    expect(r.passed).toBe(false);
    expect(r.shadowRatio).toBeGreaterThan(CONSTANTS.EXPOSURE_SHADOW_MAX_RATIO);
    expect(r.reason).toMatch(/dark/i);
  });

  it('fails when highlight clipping ratio exceeds EXPOSURE_HIGHLIGHT_MAX_RATIO', () => {
    // 50% pixels = 250 (above highlight clamp of 235), 50% = 60
    const mixed = makeImage(SIZE, SIZE, (x) => x < HALF ? 60 : 250);
    const r = exposureCheck(mixed);
    expect(r.passed).toBe(false);
    expect(r.highlightRatio).toBeGreaterThan(CONSTANTS.EXPOSURE_HIGHLIGHT_MAX_RATIO);
    expect(r.reason).toMatch(/bright/i);
  });

  it('score is 1 for mean exactly at 127.5', () => {
    // Build an image where exactly half pixels are 80 and half 175 → mean = 127.5
    const r = exposureCheck(stepEdge80_175);
    expect(r.score).toBeCloseTo(1, 1);
  });
});

// ─── inFrameCheck ─────────────────────────────────────────────────────────────

describe('inFrameCheck', () => {
  it('passes for step-edge — contiguous edge detected across all interior rows', () => {
    const r = inFrameCheck(stepEdge80_175);
    expect(r.passed).toBe(true);
    expect(r.edgeDensity).toBeGreaterThan(CONSTANTS.EDGE_DENSITY_MIN);
    expect(r.reason).toBeUndefined();
  });

  it('fails for flat gray — Sobel gradient is zero everywhere', () => {
    const r = inFrameCheck(flat128);
    expect(r.passed).toBe(false);
    expect(r.edgeDensity).toBe(0);
    expect(r.reason).toMatch(/closer|frame/i);
  });

  it('fails for checkerboard — 3×3 Sobel kernel cancels on 1-pixel alternating pattern', () => {
    // Verified analytically: Gx and Gy both sum to zero for every interior pixel
    // of an alternating-value checkerboard (symmetric cancellation in 3×3 window).
    const r = inFrameCheck(checkerboard80_175);
    expect(r.passed).toBe(false);
    expect(r.edgeDensity).toBe(0);
  });

  it('fails for all-black — no gradients', () => {
    expect(inFrameCheck(allBlack).passed).toBe(false);
  });

  it('edge density scales with the length of the step edge', () => {
    // Wider image → same 2-column edge / more total interior → lower density
    const wide = makeImage(32, SIZE, (x) => x < 16 ? 80 : 175);
    const narrow = makeImage(16, SIZE, (x) => x < 8 ? 80 : 175);
    // Both have a single 2-column boundary so density should be similar
    const dWide = inFrameCheck(wide).edgeDensity;
    const dNarrow = inFrameCheck(narrow).edgeDensity;
    // Both must pass, but wide has smaller density fraction
    expect(dNarrow).toBeGreaterThanOrEqual(dWide);
  });
});

// ─── runQualityGates ─────────────────────────────────────────────────────────

describe('runQualityGates', () => {
  it('passes all three gates on step-edge 80/175', () => {
    const out = runQualityGates(stepEdge80_175);
    expect(out.passed).toBe(true);
    expect(out.results).toHaveLength(3);
    expect(out.results.every(r => r.passed)).toBe(true);
  });

  it('returns passed=false when any gate fails', () => {
    expect(runQualityGates(allBlack).passed).toBe(false);
    expect(runQualityGates(flat128).passed).toBe(false);
  });

  it('quality_meta contains all required JSONB fields', () => {
    const { quality_meta: m } = runQualityGates(stepEdge80_175);
    expect(typeof m.blur_variance).toBe('number');
    expect(typeof m.mean_luminance).toBe('number');
    expect(typeof m.shadow_ratio).toBe('number');
    expect(typeof m.highlight_ratio).toBe('number');
    expect(typeof m.edge_density).toBe('number');
    expect(m.results).toHaveLength(3);
  });

  it('quality_meta.score is in [0, 1]', () => {
    const { quality_meta: m } = runQualityGates(stepEdge80_175);
    expect(m.score).toBeGreaterThan(0);
    expect(m.score).toBeLessThanOrEqual(1);
  });

  it('quality_meta.passed mirrors the top-level passed', () => {
    const pass = runQualityGates(stepEdge80_175);
    expect(pass.quality_meta.passed).toBe(pass.passed);

    const fail = runQualityGates(allBlack);
    expect(fail.quality_meta.passed).toBe(fail.passed);
  });

  it('flat128: blur and inFrame fail; exposure passes', () => {
    const out = runQualityGates(flat128);
    expect(out.passed).toBe(false);
    const byGate = Object.fromEntries(out.results.map(r => [r.gate, r]));
    expect(byGate['blur']!.passed).toBe(false);
    expect(byGate['exposure']!.passed).toBe(true);
    expect(byGate['inFrame']!.passed).toBe(false);
  });

  it('checkerboard: blur passes; inFrame fails; exposure passes', () => {
    const out = runQualityGates(checkerboard80_175);
    const byGate = Object.fromEntries(out.results.map(r => [r.gate, r]));
    expect(byGate['blur']!.passed).toBe(true);
    expect(byGate['exposure']!.passed).toBe(true);
    expect(byGate['inFrame']!.passed).toBe(false);
  });

  it('gate names are "blur", "exposure", "inFrame" in that order', () => {
    const { results } = runQualityGates(flat128);
    expect(results.map(r => r.gate)).toEqual(['blur', 'exposure', 'inFrame']);
  });

  it('diagnostics in quality_meta agree with individual gate results', () => {
    const img = stepEdge80_175;
    const out = runQualityGates(img);
    const blur = blurCheck(img);
    const exposure = exposureCheck(img);
    const inFrame = inFrameCheck(img);
    expect(out.quality_meta.blur_variance).toBe(blur.blurVariance);
    expect(out.quality_meta.mean_luminance).toBe(exposure.meanLuminance);
    expect(out.quality_meta.edge_density).toBe(inFrame.edgeDensity);
  });
});
