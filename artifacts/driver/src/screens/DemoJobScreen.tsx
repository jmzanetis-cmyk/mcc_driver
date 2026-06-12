// ============================================================
// MCC Driver — Demo Job Screen (Step 8)
//
// Entry point for App Review and QA demos.
// The demo driver (+15555550199 / OTP 123456) lands here,
// presses "Start Demo Leg", and the Bergen County ping trail
// replays through the real publisher pipeline.
// A reviewer-member account on mycarconcierge can watch the
// marker move in real time.
// ============================================================

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { borderRadius, colors } from '@/theme';
import {
  DEMO_JOB_ID,
  DEMO_HANDOFF_ID,
  startReplay,
  stopReplay,
  replayProgress,
} from '@/services/tracking/demoReplay';
import { useTrackingPublisher } from '@/hooks/useTrackingPublisher';

export function DemoJobScreen() {
  const navigate    = useNavigate();
  const { isPublishing } = useTrackingPublisher();
  const [running,   setRunning]  = useState(false);
  const [progress,  setProgress] = useState({ current: 0, total: 0 });
  const [error,     setError]    = useState<string | null>(null);

  // Poll progress while replay is active.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setProgress(replayProgress()), 600);
    return () => clearInterval(t);
  }, [running]);

  // Detect auto-stop when the trail finishes.
  useEffect(() => {
    if (running && !isPublishing) {
      setRunning(false);
    }
  }, [isPublishing, running]);

  const handleStart = async () => {
    setError(null);
    setRunning(true);
    const ok = await startReplay({
      jobId:      DEMO_JOB_ID,
      handoffId:  DEMO_HANDOFF_ID,
      leg:        'member_to_driver',
      driverRole: 'primary',
      eventKind:  'leg',
    });
    if (!ok) {
      setRunning(false);
      setError('Could not start replay — check that live_tracking_enabled is true on the demo job.');
    }
  };

  const handleStop = async () => {
    await stopReplay();
    setRunning(false);
  };

  const pct = progress.total > 0
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary, padding: 24, boxSizing: 'border-box' }}>

      {/* DEMO watermark — fixed top-right */}
      <div aria-label="Demo mode active" style={{
        position:     'fixed',
        top:          12,
        right:        12,
        zIndex:       9999,
        background:   'rgba(201,152,46,0.18)',
        border:       '1px solid rgba(201,152,46,0.55)',
        borderRadius: borderRadius.full,
        padding:      '4px 12px',
        fontSize:     11,
        fontWeight:   800,
        letterSpacing: 1.5,
        color:        'var(--accent-gold)',
        pointerEvents:'none',
      }}>
        DEMO
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={() => navigate('/home')}
            style={{ background: 'none', border: 'none', color: colors.textMuted, cursor: 'pointer', padding: 0, fontSize: 13, marginBottom: 12 }}
          >
            ← Back
          </button>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: colors.textPrimary }}>
            Demo Leg
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: colors.textSecondary }}>
            Replays a Bergen County route through the live tracking pipeline.
            Open the reviewer-member account to watch the pin move.
          </p>
        </div>

        {/* Job card */}
        <div style={{
          background:   colors.bgCard,
          border:       '1px solid var(--border-subtle)',
          borderRadius: borderRadius.md,
          padding:      16,
          marginBottom: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>Concierge Job — Tier 2</span>
            <span style={{
              background:   'rgba(201,152,46,0.15)',
              border:       '1px solid rgba(201,152,46,0.4)',
              borderRadius: borderRadius.full,
              padding:      '2px 8px',
              fontSize:     10,
              fontWeight:   700,
              color:        'var(--accent-gold)',
              letterSpacing: 1,
            }}>DEMO</span>
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 4 }}>
            <strong>Leg:</strong> member_to_driver
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 4 }}>
            <strong>From:</strong> Hackensack, NJ
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary }}>
            <strong>To:</strong> Paramus, NJ (provider shop)
          </div>
        </div>

        {/* Progress bar (shown while running) */}
        {running && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: colors.textMuted }}>
              <span>Replay progress</span>
              <span>{progress.current} / {progress.total} pings · {pct}%</span>
            </div>
            <div style={{ height: 6, background: 'var(--border-subtle)', borderRadius: borderRadius.full, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent-gold)', borderRadius: borderRadius.full, transition: 'width 0.5s ease' }} />
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            padding: '10px 14px', marginBottom: 16, borderRadius: borderRadius.md,
            background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)',
            fontSize: 13, color: 'rgba(220,38,38,0.9)',
          }}>
            {error}
          </div>
        )}

        {/* Action buttons */}
        {!running ? (
          <button
            onClick={handleStart}
            style={{
              width: '100%', padding: '14px 0', border: 'none', cursor: 'pointer',
              borderRadius: borderRadius.md, fontWeight: 700, fontSize: 15,
              background: 'var(--accent-gold)', color: '#1a1200',
            }}
          >
            ▶ Start Demo Leg
          </button>
        ) : (
          <button
            onClick={handleStop}
            style={{
              width: '100%', padding: '14px 0', border: 'none', cursor: 'pointer',
              borderRadius: borderRadius.md, fontWeight: 700, fontSize: 15,
              background: 'var(--accent-red, #dc2626)', color: '#fff',
            }}
          >
            ■ Stop Demo
          </button>
        )}

        {/* Review notes */}
        <div style={{ marginTop: 32, padding: 14, background: colors.bgCard, borderRadius: borderRadius.md, border: '1px solid var(--border-subtle)' }}>
          <p style={{ margin: 0, fontSize: 11, color: colors.textMuted, lineHeight: 1.6 }}>
            <strong style={{ color: colors.textSecondary }}>For App Review:</strong> The demo driver account (+15555550199 / OTP 123456) is pre-approved
            with live_tracking_enabled = true on this job. The reviewer-member account can observe
            location pings on the mycarconcierge member tracking page in real time.
          </p>
        </div>

      </div>
    </div>
  );
}
