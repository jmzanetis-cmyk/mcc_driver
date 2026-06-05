// Guided multi-angle capture overlay.
// Primary path: @capacitor-community/camera-preview (live viewfinder).
// Fallback: captureLiveShot() via @capacitor/camera when preview cannot start.
// This component is standalone — wire it into CustodyHandoffScreen in Part 4.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CameraPreview } from '@capacitor-community/camera-preview';
import { Geolocation } from '@capacitor/geolocation';
import {
  createProgress,
  recordAngle,
  isComplete,
  type ProgressState,
} from '@/services/custody/captureProgress';
import { runQualityGates, type QualityGatesOutput } from '@/services/custody/qualityGates';
import { captureLiveShot, type Gps } from '@/services/custody/custody.client';
import { type PhotoAngle } from '@/services/custody/custody.types';

// ── angle metadata ────────────────────────────────────────────────────────────

const ANGLE_META: Record<PhotoAngle, { label: string; hint: string; icon: string }> = {
  front:          { label: 'Front',             icon: '▲', hint: 'Stand directly in front. Frame full bumper to roofline.' },
  rear:           { label: 'Rear',              icon: '▼', hint: 'Stand directly behind. Frame the full rear end.' },
  driver_side:    { label: "Driver's Side",     icon: '◀', hint: 'Left side profile — both wheels visible.' },
  passenger_side: { label: "Passenger's Side",  icon: '▶', hint: 'Right side profile — both wheels visible.' },
  roof:           { label: 'Roof',              icon: '⬛', hint: 'From a slight angle — capture the full roof panel.' },
  wheel_fl:       { label: 'Wheel: Front-L',    icon: '⭕', hint: 'Close-up of front-left wheel and tire.' },
  wheel_fr:       { label: 'Wheel: Front-R',    icon: '⭕', hint: 'Close-up of front-right wheel and tire.' },
  wheel_rl:       { label: 'Wheel: Rear-L',     icon: '⭕', hint: 'Close-up of rear-left wheel and tire.' },
  wheel_rr:       { label: 'Wheel: Rear-R',     icon: '⭕', hint: 'Close-up of rear-right wheel and tire.' },
  interior_front: { label: 'Interior Front',    icon: '🪑', hint: 'Front seats and dashboard — doors open.' },
  interior_rear:  { label: 'Interior Rear',     icon: '🪑', hint: 'Rear seat area and floor.' },
  cargo:          { label: 'Cargo / Trunk',     icon: '📦', hint: 'Trunk or cargo area with lid open.' },
  odometer:       { label: 'Odometer',          icon: '🔢', hint: 'Dashboard — show mileage reading clearly.' },
  fuel_gauge:     { label: 'Fuel / Charge',     icon: '⛽', hint: 'Dashboard — show fuel or charge level clearly.' },
  other:          { label: 'Additional',        icon: '📷', hint: 'Any other relevant condition to document.' },
};

// ── public types ──────────────────────────────────────────────────────────────

export interface CaptureResult {
  angle: PhotoAngle;
  blob: Blob;
  capturedAt: string;
  gps: Gps;
  qualityOutput: QualityGatesOutput;
}

export interface GuidedCaptureOverlayProps {
  requiredAngles: PhotoAngle[];
  onComplete: (results: CaptureResult[]) => void;
  onCancel: () => void;
}

// ── phase union ───────────────────────────────────────────────────────────────

type Phase =
  | { tag: 'starting' }
  | { tag: 'ready' }
  | { tag: 'checking' }
  | { tag: 'fail'; reason: string; gate: string }
  | { tag: 'saving' };

// ── helpers ───────────────────────────────────────────────────────────────────

async function base64ToImageLike(
  base64: string,
  maxDim = 320,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth || 1;
      const nh = img.naturalHeight || 1;
      const scale = Math.min(1, maxDim / Math.max(nw, nh));
      const w = Math.max(1, Math.round(nw * scale));
      const h = Math.max(1, Math.round(nh * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = () => reject(new Error('Image decode failed'));
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function readGps(): Promise<Gps> {
  try {
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 8000 });
    return { lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: p.coords.accuracy };
  } catch {
    return { lat: null, lng: null, accuracy_m: null };
  }
}

function firstFailure(qOut: QualityGatesOutput): { reason: string; gate: string } | null {
  const failed = qOut.results.find(r => !r.passed);
  if (!failed) return null;
  return { reason: failed.reason ?? `${failed.gate} quality check failed.`, gate: failed.gate };
}

// ── component ─────────────────────────────────────────────────────────────────

export function GuidedCaptureOverlay({
  requiredAngles,
  onComplete,
  onCancel,
}: GuidedCaptureOverlayProps) {
  const [phase, setPhase] = useState<Phase>({ tag: 'starting' });
  const [angleIndex, setAngleIndex] = useState(0);
  const [progress, setProgress] = useState<ProgressState>(() => createProgress());
  const [results, setResults] = useState<CaptureResult[]>([]);
  const [usingFallback, setUsingFallback] = useState(false);

  const cameraStarted = useRef(false);
  const savedBodyBg = useRef('');
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  const currentAngle = requiredAngles[angleIndex] ?? null;

  // Start / stop camera around overlay lifetime
  useEffect(() => {
    if (requiredAngles.length === 0) {
      onCompleteRef.current([]);
      return;
    }

    savedBodyBg.current = document.body.style.backgroundColor;
    document.body.style.backgroundColor = 'transparent';

    let cancelled = false;

    CameraPreview.start({
      position: 'rear',
      x: 0,
      y: 0,
      width: window.screen.width,
      height: Math.round(window.screen.height * 0.65),
      disableAudio: true,
    }).then(() => {
      if (cancelled) return;
      cameraStarted.current = true;
      setPhase({ tag: 'ready' });
    }).catch(() => {
      if (cancelled) return;
      setUsingFallback(true);
      setPhase({ tag: 'ready' });
    });

    return () => {
      cancelled = true;
      document.body.style.backgroundColor = savedBodyBg.current;
      if (cameraStarted.current) {
        CameraPreview.stop().catch(() => undefined);
        cameraStarted.current = false;
      }
    };
  }, []); // intentionally empty — camera lifetime == component lifetime

  const advance = useCallback((
    angle: PhotoAngle,
    blob: Blob,
    gps: Gps,
    qOut: QualityGatesOutput,
    currentProgress: ProgressState,
    currentResults: CaptureResult[],
  ) => {
    const result: CaptureResult = {
      angle,
      blob,
      capturedAt: new Date().toISOString(),
      gps,
      qualityOutput: qOut,
    };
    const nextResults = [...currentResults, result];
    const nextProgress = recordAngle(currentProgress, angle, {
      passed: true,
      meta: qOut.quality_meta as unknown as Record<string, unknown>,
    });

    if (isComplete(nextProgress, requiredAngles)) {
      if (cameraStarted.current) {
        CameraPreview.stop().catch(() => undefined);
        cameraStarted.current = false;
      }
      onCompleteRef.current(nextResults);
    } else {
      setProgress(nextProgress);
      setResults(nextResults);
      setAngleIndex(i => i + 1);
      setPhase({ tag: 'ready' });
    }
  }, [requiredAngles]);

  const handleCapture = useCallback(async () => {
    if (!currentAngle) return;
    setPhase({ tag: 'checking' });

    try {
      if (!usingFallback) {
        const sample = await CameraPreview.captureSample({ quality: 70 });
        const imageLike = await base64ToImageLike(sample.value);
        const qOut = runQualityGates(imageLike);

        const fail = firstFailure(qOut);
        if (fail) { setPhase({ tag: 'fail', ...fail }); return; }

        setPhase({ tag: 'saving' });
        const [capture, gps] = await Promise.all([
          CameraPreview.capture({ quality: 85 }),
          readGps(),
        ]);
        const bytes = Uint8Array.from(atob(capture.value), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'image/jpeg' });
        advance(currentAngle, blob, gps, qOut, progress, results);
      } else {
        // Fallback: let @capacitor/camera handle the actual shutter
        const shot = await captureLiveShot();
        const base64 = await blobToBase64(shot.blob);
        const imageLike = await base64ToImageLike(base64);
        const qOut = runQualityGates(imageLike);

        const fail = firstFailure(qOut);
        if (fail) { setPhase({ tag: 'fail', ...fail }); return; }

        setPhase({ tag: 'saving' });
        advance(currentAngle, shot.blob, shot.gps, qOut, progress, results);
      }
    } catch {
      setPhase({ tag: 'fail', reason: 'Capture failed — please try again.', gate: 'capture' });
    }
  }, [currentAngle, usingFallback, progress, results, advance]);

  const handleRetry = useCallback(() => setPhase({ tag: 'ready' }), []);

  if (!currentAngle) return null;

  const meta = ANGLE_META[currentAngle];
  const total = requiredAngles.length;
  const doneCount = angleIndex;
  const isChecking = phase.tag === 'checking' || phase.tag === 'saving';
  const isStarting = phase.tag === 'starting';
  const isFailed = phase.tag === 'fail';

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', flexDirection: 'column' }}>

      {/* ── Camera viewport — native preview shows through transparent bg ── */}
      <div style={{ flex: '0 0 65%', background: 'transparent', position: 'relative' }}>

        {isStarting && (
          <div style={{
            position: 'absolute', inset: 0, background: '#0B1220',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: '#D4AF37', fontSize: 14 }}>Starting camera…</span>
          </div>
        )}

        {/* Progress pip strip */}
        {!isStarting && (
          <div style={{
            position: 'absolute', top: 14, left: 0, right: 0,
            display: 'flex', justifyContent: 'center', gap: 6,
          }}>
            {requiredAngles.map((a, i) => (
              <div key={a} style={{
                width: i === doneCount ? 20 : 8,
                height: 8,
                borderRadius: 4,
                background: i < doneCount
                  ? '#10B981'
                  : i === doneCount
                  ? '#D4AF37'
                  : 'rgba(255,255,255,0.25)',
                transition: 'width 0.2s',
              }} />
            ))}
          </div>
        )}

        {/* Angle icon reticle — centered */}
        {!isStarting && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 72, height: 72, borderRadius: '50%',
            border: '2px solid rgba(212,175,55,0.75)',
            background: 'rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28,
          }}>
            {meta.icon}
          </div>
        )}
      </div>

      {/* ── Controls panel ── */}
      <div style={{
        flex: '0 0 35%',
        background: 'rgba(11,18,32,0.97)',
        borderTop: '1px solid rgba(212,175,55,0.2)',
        padding: '14px 20px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: '#D4AF37', fontWeight: 700, fontSize: 16 }}>{meta.label}</span>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
            {doneCount + 1} / {total}
          </span>
        </div>

        <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, margin: 0, lineHeight: 1.4 }}>
          {meta.hint}
        </p>

        {isFailed && (
          <div style={{
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 8, padding: '8px 12px',
            color: '#FCA5A5', fontSize: 13,
          }}>
            {(phase as Extract<Phase, { tag: 'fail' }>).reason}
          </div>
        )}

        {usingFallback && phase.tag === 'ready' && (
          <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: 0, textAlign: 'center' }}>
            Live preview unavailable — tap Capture to use the standard camera
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
          <button
            onClick={onCancel}
            disabled={isChecking}
            style={{
              flex: '0 0 auto', padding: '10px 16px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent', color: 'rgba(255,255,255,0.6)',
              fontSize: 14, cursor: isChecking ? 'not-allowed' : 'pointer',
              opacity: isChecking ? 0.5 : 1,
            }}
          >
            Cancel
          </button>

          {isFailed ? (
            <button
              onClick={handleRetry}
              style={{
                flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none',
                background: 'rgba(59,130,246,0.85)', color: '#fff',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Retry
            </button>
          ) : (
            <button
              onClick={handleCapture}
              disabled={isChecking || isStarting}
              style={{
                flex: 1, padding: '10px 16px', borderRadius: 8, border: 'none',
                background: isChecking || isStarting ? 'rgba(212,175,55,0.45)' : '#D4AF37',
                color: '#0B1220', fontSize: 14, fontWeight: 700,
                cursor: isChecking || isStarting ? 'not-allowed' : 'pointer',
              }}
            >
              {isStarting ? 'Starting…' : isChecking ? 'Checking…' : 'Capture'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
