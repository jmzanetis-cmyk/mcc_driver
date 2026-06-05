// Pure image-quality gate functions for custody photo capture.
// No I/O, no Capacitor, no side effects — every function is fully unit-testable.
// All thresholds live in CONSTANTS so they can be tuned without touching logic.

// ─── Tunable thresholds ──────────────────────────────────────────────────────

export const CONSTANTS = {
  // blurCheck: Laplacian variance; below this → blurry
  BLUR_VARIANCE_THRESHOLD: 100,

  // exposureCheck: mean luminance bounds (0–255 scale)
  EXPOSURE_MIN_MEAN: 40,
  EXPOSURE_MAX_MEAN: 215,

  // exposureCheck: per-pixel shadow/highlight clamping values
  EXPOSURE_SHADOW_CLAMP: 20,
  EXPOSURE_HIGHLIGHT_CLAMP: 235,

  // exposureCheck: max allowable fraction of shadow / highlight pixels
  EXPOSURE_SHADOW_MAX_RATIO: 0.20,
  EXPOSURE_HIGHLIGHT_MAX_RATIO: 0.20,

  // inFrameCheck: minimum Sobel gradient magnitude to count a pixel as an edge
  SOBEL_EDGE_THRESHOLD: 30,

  // inFrameCheck: minimum fraction of interior pixels that must be edges
  EDGE_DENSITY_MIN: 0.05,
} as const;

// ─── Public types ────────────────────────────────────────────────────────────

export interface GateResult {
  gate: string;
  passed: boolean;
  score: number;   // 0–1, higher is better
  reason?: string;
}

// Extended result types expose per-gate diagnostics consumed by runQualityGates
// to populate quality_meta without re-scanning the pixel buffer.

export interface BlurResult extends GateResult {
  gate: 'blur';
  blurVariance: number;
}

export interface ExposureResult extends GateResult {
  gate: 'exposure';
  meanLuminance: number;
  shadowRatio: number;
  highlightRatio: number;
}

export interface InFrameResult extends GateResult {
  gate: 'inFrame';
  edgeDensity: number;
}

export interface QualityMeta {
  passed: boolean;
  score: number;
  results: GateResult[];
  // Diagnostic numerics — stored in the quality_meta JSONB column as-is
  blur_variance: number;
  mean_luminance: number;
  shadow_ratio: number;
  highlight_ratio: number;
  edge_density: number;
}

export interface QualityGatesOutput {
  passed: boolean;
  results: GateResult[];
  quality_meta: QualityMeta;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

// Duck-compatible with browser ImageData — avoids importing the Web API type.
interface ImageLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// Single-pass RGBA → grayscale luminance (ITU-R BT.601 coefficients).
function toLuminance(src: ImageLike): Float32Array {
  const n = src.width * src.height;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = i * 4;
    lum[i] = 0.299 * src.data[b] + 0.587 * src.data[b + 1] + 0.114 * src.data[b + 2];
  }
  return lum;
}

// ─── Gate: blur ───────────────────────────────────────────────────────────────
//
// Laplacian kernel [ 0 1 0 / 1 -4 1 / 0 1 0 ] applied to the luminance channel.
// Variance of the response values measures "sharpness" — flat/blurry images
// produce near-zero responses everywhere, while in-focus images produce large
// positive and negative values at every edge.

export function blurCheck(src: ImageLike): BlurResult {
  const { width, height } = src;
  const lum = toLuminance(src);

  const values: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const c = y * width + x;
      values.push(
        lum[c - width] + lum[c + width] + lum[c - 1] + lum[c + 1] - 4 * lum[c],
      );
    }
  }

  if (values.length === 0) {
    return { gate: 'blur', passed: false, score: 0, reason: 'Image too small to evaluate.', blurVariance: 0 };
  }

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const score = Math.min(variance / (CONSTANTS.BLUR_VARIANCE_THRESHOLD * 10), 1);
  const passed = variance >= CONSTANTS.BLUR_VARIANCE_THRESHOLD;

  return {
    gate: 'blur',
    passed,
    score,
    blurVariance: variance,
    ...(passed ? {} : { reason: 'Too blurry — hold steady and tap to focus.' }),
  };
}

// ─── Gate: exposure ───────────────────────────────────────────────────────────
//
// Checks mean luminance and per-pixel shadow/highlight clipping ratios.
// A photo can fail exposure by being globally dark/bright OR by having too
// many clipped pixels even at a reasonable mean (e.g. silhouetted subject).

export function exposureCheck(src: ImageLike): ExposureResult {
  const { width, height } = src;
  const lum = toLuminance(src);
  const n = width * height;

  let sum = 0;
  let shadowCount = 0;
  let highlightCount = 0;

  for (let i = 0; i < n; i++) {
    const l = lum[i];
    sum += l;
    if (l < CONSTANTS.EXPOSURE_SHADOW_CLAMP) shadowCount++;
    if (l > CONSTANTS.EXPOSURE_HIGHLIGHT_CLAMP) highlightCount++;
  }

  const meanLuminance = sum / n;
  const shadowRatio = shadowCount / n;
  const highlightRatio = highlightCount / n;
  // Score peaks at mean = 127.5 and falls symmetrically to 0 at 0 or 255.
  const score = 1 - Math.abs(meanLuminance - 127.5) / 127.5;

  if (meanLuminance < CONSTANTS.EXPOSURE_MIN_MEAN || shadowRatio > CONSTANTS.EXPOSURE_SHADOW_MAX_RATIO) {
    return {
      gate: 'exposure', passed: false, score, meanLuminance, shadowRatio, highlightRatio,
      reason: 'Too dark — move to a brighter spot or turn on a light.',
    };
  }
  if (meanLuminance > CONSTANTS.EXPOSURE_MAX_MEAN || highlightRatio > CONSTANTS.EXPOSURE_HIGHLIGHT_MAX_RATIO) {
    return {
      gate: 'exposure', passed: false, score, meanLuminance, shadowRatio, highlightRatio,
      reason: 'Too bright — avoid pointing the camera at direct light sources.',
    };
  }

  return { gate: 'exposure', passed: true, score, meanLuminance, shadowRatio, highlightRatio };
}

// ─── Gate: inFrame ────────────────────────────────────────────────────────────
//
// Sobel edge-density heuristic. Too few edges → the vehicle isn't filling the
// frame (camera is too far away or pointed at a blank surface).
//
// Sobel Gx: [ -1 0 1 / -2 0 2 / -1 0 1 ]
// Sobel Gy: [  1 2 1 /  0 0 0 / -1 -2 -1 ]

export function inFrameCheck(src: ImageLike): InFrameResult {
  const { width, height } = src;
  const lum = toLuminance(src);

  let edgeCount = 0;
  let interior = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      interior++;
      const gx =
        -lum[(y - 1) * width + (x - 1)] + lum[(y - 1) * width + (x + 1)] +
        -2 * lum[y * width + (x - 1)] + 2 * lum[y * width + (x + 1)] +
        -lum[(y + 1) * width + (x - 1)] + lum[(y + 1) * width + (x + 1)];

      const gy =
        lum[(y - 1) * width + (x - 1)] + 2 * lum[(y - 1) * width + x] + lum[(y - 1) * width + (x + 1)] +
        -lum[(y + 1) * width + (x - 1)] - 2 * lum[(y + 1) * width + x] - lum[(y + 1) * width + (x + 1)];

      if (Math.sqrt(gx * gx + gy * gy) > CONSTANTS.SOBEL_EDGE_THRESHOLD) edgeCount++;
    }
  }

  if (interior === 0) {
    return { gate: 'inFrame', passed: false, score: 0, reason: 'Image too small to evaluate.', edgeDensity: 0 };
  }

  const edgeDensity = edgeCount / interior;
  const score = Math.min(edgeDensity / (CONSTANTS.EDGE_DENSITY_MIN * 4), 1);
  const passed = edgeDensity >= CONSTANTS.EDGE_DENSITY_MIN;

  return {
    gate: 'inFrame',
    passed,
    score,
    edgeDensity,
    ...(passed ? {} : { reason: 'Move closer or fill the frame with the vehicle.' }),
  };
}

// ─── Combined runner ──────────────────────────────────────────────────────────

export function runQualityGates(src: ImageLike): QualityGatesOutput {
  const blur = blurCheck(src);
  const exposure = exposureCheck(src);
  const inFrame = inFrameCheck(src);

  const results: GateResult[] = [blur, exposure, inFrame];
  const passed = results.every(r => r.passed);
  const score = results.reduce((s, r) => s + r.score, 0) / results.length;

  const quality_meta: QualityMeta = {
    passed,
    score,
    results,
    blur_variance:    blur.blurVariance,
    mean_luminance:   exposure.meanLuminance,
    shadow_ratio:     exposure.shadowRatio,
    highlight_ratio:  exposure.highlightRatio,
    edge_density:     inFrame.edgeDensity,
  };

  return { passed, results, quality_meta };
}
