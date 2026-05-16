// ============================================================
// MCC Driver — Ride-Along Driver Pending / Status Screen
// ============================================================
// Shown after a Ride-Along Driver submits their application.
// Reflects background_check_status and verified state.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/services/supabase/client';
import { Button } from '@/components';
import { colors, borderRadius, withAlpha } from '@/theme';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface RideAlongProfile {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  backgroundCheckStatus: string;
  verified: boolean;
  licenseDocumentPath: string | null;
  insuranceDocumentPath: string | null;
  profilePhotoPath: string | null;
}

type StepStatus = 'done' | 'pending' | 'waiting';

interface Step {
  label: string;
  status: StepStatus;
}

function buildSteps(profile: RideAlongProfile): Step[] {
  const isActive = profile.status === 'active';
  const bgPassed = profile.backgroundCheckStatus === 'passed';

  return [
    { label: 'Application submitted', status: 'done' },
    { label: 'Background check', status: bgPassed ? 'done' : isActive ? 'done' : 'pending' },
    { label: 'Document review', status: bgPassed ? 'done' : isActive ? 'done' : 'pending' },
    { label: 'Account activation', status: isActive && profile.verified ? 'done' : 'waiting' },
  ];
}

export function RideAlongPendingScreen() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<RideAlongProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { navigate('/signin'); return; }

    const res = await fetch(`${BASE}/api/ride-along-drivers/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (res.status === 404) {
      navigate('/ride-along-apply');
      return;
    }

    if (!res.ok) {
      setError('Failed to load your profile. Please try again.');
      setLoading(false);
      return;
    }

    const data = await res.json() as RideAlongProfile;
    setProfile(data);
    setLoading(false);
  }, [navigate]);

  useEffect(() => { void fetchProfile(); }, [fetchProfile]);

  const isApproved = profile?.status === 'active' && profile?.verified;
  const isRejected = profile?.status === 'inactive';

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: colors.bgPrimary,
      }}>
        <div style={{ fontSize: 14, color: colors.textMuted }}>Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', padding: 32, background: colors.bgPrimary,
      }}>
        <div style={{ fontSize: 14, color: colors.error, marginBottom: 20 }}>{error}</div>
        <Button onClick={() => void fetchProfile()} variant="secondary" size="sm">Try Again</Button>
      </div>
    );
  }

  if (!profile) return null;

  const steps = buildSteps(profile);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 32,
      background: colors.bgPrimary,
    }}>
      {/* Icon */}
      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: isApproved ? `${withAlpha(colors.success, '20')}` : isRejected ? colors.errorBg : colors.warningBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, marginBottom: 20,
      }}>
        {isApproved ? '✅' : isRejected ? '❌' : '⏳'}
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.navy, marginBottom: 8, textAlign: 'center' }}>
        {isApproved
          ? "You're Verified!"
          : isRejected
            ? 'Application Not Approved'
            : 'Application Under Review'}
      </h1>

      <p style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', maxWidth: 320, marginBottom: 32 }}>
        {isApproved
          ? "Your Ride-Along Driver account is verified. Jobs will appear here as soon as tandem matching opens in your area."
          : isRejected
            ? "Your application was not approved. Please contact My Car Concierge support for more information or resubmit with updated documents."
            : "We're reviewing your application. You'll be notified once your account is activated."}
      </p>

      {/* Approval banner */}
      {isApproved && (
        <div style={{
          width: '100%', maxWidth: 360, marginBottom: 20,
          padding: 16, background: `${withAlpha(colors.success, '10')}`,
          borderRadius: borderRadius.lg, border: `1px solid ${withAlpha(colors.success, '30')}`,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: colors.success, marginBottom: 4 }}>
            Ride-Along Driver — Verified
          </div>
          <div style={{ fontSize: 13, color: colors.textMuted }}>
            Your profile is active. Jobs will be dispatched as soon as tandem matching opens in your area.
          </div>
        </div>
      )}

      {/* Status checklist */}
      {!isApproved && (
        <div style={{
          background: colors.bgCard, borderRadius: borderRadius.lg,
          border: `1px solid ${colors.border}`, padding: 20,
          width: '100%', maxWidth: 360, marginBottom: 20,
        }}>
          {steps.map((step, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 0',
              borderBottom: i < steps.length - 1 ? `1px solid ${colors.borderLight}` : 'none',
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                background: step.status === 'done' ? colors.success : step.status === 'pending' ? colors.warningBg : colors.bgSecondary,
                color: step.status === 'done' ? '#fff' : step.status === 'pending' ? colors.warning : colors.textMuted,
              }}>
                {step.status === 'done' ? '✓' : step.status === 'pending' ? '•' : '○'}
              </div>
              <span style={{
                fontSize: 14,
                color: step.status === 'done' ? colors.success : step.status === 'pending' ? colors.textPrimary : colors.textMuted,
                fontWeight: step.status === 'pending' ? 500 : 400,
              }}>
                {step.label}
              </span>
              {step.status === 'pending' && (
                <span style={{
                  marginLeft: 'auto', fontSize: 11, fontWeight: 600,
                  color: colors.warning, background: colors.warningBg,
                  padding: '2px 8px', borderRadius: 4,
                }}>IN PROGRESS</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Documents received */}
      {(profile.licenseDocumentPath || profile.insuranceDocumentPath || profile.profilePhotoPath) && (
        <div style={{
          marginBottom: 16, padding: 12,
          background: `${withAlpha(colors.success, '15')}`, borderRadius: borderRadius.md,
          border: `1px solid ${withAlpha(colors.success, '30')}`,
          width: '100%', maxWidth: 360,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.success, marginBottom: 6 }}>
            Documents Received
          </div>
          {profile.licenseDocumentPath && <div style={{ fontSize: 12, color: colors.textMuted }}>✓ Driver's license photo</div>}
          {profile.insuranceDocumentPath && <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>✓ Proof of insurance</div>}
          {profile.profilePhotoPath && <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>✓ Profile photo</div>}
        </div>
      )}

      {/* Resubmit banner for rejected applicants */}
      {isRejected && profile && (
        <div style={{
          width: '100%', maxWidth: 360, marginBottom: 16,
          padding: 16, background: colors.errorBg,
          borderRadius: borderRadius.md, border: `1px solid ${withAlpha(colors.error, '30')}`,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 13, color: colors.error, marginBottom: 12 }}>
            You can update your documents and resubmit your application for review.
          </div>
          <ResubmitButton profileId={profile.id} onSuccess={fetchProfile} />
        </div>
      )}

      <div style={{ display: 'flex', gap: 12 }}>
        <Button onClick={() => void fetchProfile()} variant="secondary" size="sm">
          Check Status
        </Button>
        <Button onClick={() => void supabase.auth.signOut().then(() => navigate('/signin'))} variant="ghost" size="sm">
          Sign Out
        </Button>
      </div>
    </div>
  );
}

// ── ResubmitButton ────────────────────────────────────────────────────────────
// Calls PATCH /ride-along-drivers/:id with empty body to trigger
// the automatic resubmit logic (inactive → pending_approval).

function ResubmitButton({ profileId, onSuccess }: { profileId: string; onSuccess: () => void }) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  const handleResubmit = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
      const res = await fetch(`${BASE}/api/ride-along-drivers/${profileId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const body = await res.json() as { error?: string };
        setError(body.error ?? 'Failed to resubmit. Please try again.');
      } else {
        onSuccess();
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button onClick={() => void handleResubmit()} loading={loading} size="sm" fullWidth>
        Resubmit Application
      </Button>
      {error && (
        <div style={{ fontSize: 12, color: colors.error, marginTop: 8 }}>{error}</div>
      )}
    </>
  );
}
