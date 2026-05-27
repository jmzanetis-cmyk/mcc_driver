// ============================================================
// MCC Driver — Driver Profile Screen
// ============================================================

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/services/supabase/client';
import { PageHeader, Card, Spinner, Button } from '@/components';
import { colors, borderRadius } from '@/theme';
import { apiUrl } from '@/services/api/baseUrl';
import { getStarDisplay, formatDate } from '@/utils/formatters';

interface Milestone {
  id: string;
  kind: string;
  label: string;
  icon: string;
  earned_at: string;
}

interface VehicleInfo {
  id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plate: string;
}

interface ProfileData {
  bio: string | null;
  memberSince: string | null;
  vehicle: VehicleInfo | null;
  photoUrl: string | null;
}

export function DriverProfileScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const [profile, setProfile] = useState<ProfileData>({ bio: null, memberSince: null, vehicle: null, photoUrl: null });
  const [loading, setLoading] = useState(true);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [editingBio, setEditingBio] = useState(false);
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    if (!driver) return;
    void (async () => {
      const [driverRes, vehicleRes] = await Promise.all([
        supabase.from('drivers')
          .select('bio, created_at, profile_photo_url')
          .eq('id', driver.id)
          .single(),
        supabase.from('vehicles')
          .select('id, make, model, year, color, plate')
          .eq('driver_id', driver.id)
          .eq('is_active', true)
          .maybeSingle(),
      ]);

      const d = driverRes.data as { bio: string | null; created_at: string | null; profile_photo_url: string | null } | null;
      const v = vehicleRes.data as VehicleInfo | null;
      setProfile({
        bio: d?.bio ?? null,
        memberSince: d?.created_at ?? null,
        vehicle: v,
        photoUrl: d?.profile_photo_url ?? driver.profilePhotoUrl ?? null,
      });
      setBio(d?.bio ?? '');
      setLoading(false);
    })();
  }, [driver?.id]);

  useEffect(() => {
    if (!driver) return;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(apiUrl('/milestones'), {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          const j = await res.json() as { milestones: Milestone[] };
          setMilestones(j.milestones);
        }
      } catch { /* ignore */ }
    })();
  }, [driver?.id]);

  const handleSaveBio = async () => {
    if (!driver) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await fetch(apiUrl('/drivers/profile'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ bio }),
      });
      setProfile((p) => ({ ...p, bio }));
      setEditingBio(false);
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !driver) return;
    setUploadingPhoto(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${driver.id}/profile.${ext}`;
      await supabase.storage.from('driver-photos').upload(path, file, { upsert: true });
      const { data } = supabase.storage.from('driver-photos').getPublicUrl(path);
      if (data.publicUrl) {
        await supabase.from('drivers').update({ profile_photo_url: data.publicUrl }).eq('id', driver.id);
        setProfile((p) => ({ ...p, photoUrl: data.publicUrl }));
      }
    } finally {
      setUploadingPhoto(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
        <PageHeader title="My Profile" onBack={() => navigate('/settings')} />
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="My Profile" onBack={() => navigate('/settings')} />

      <div style={{ padding: 20 }}>
        {/* Hero card */}
        <div style={{
          background: colors.surfaceDark, borderRadius: borderRadius.lg,
          padding: 24, marginBottom: 16, textAlign: 'center',
        }}>
          {/* Avatar */}
          <div style={{ position: 'relative', display: 'inline-block', marginBottom: 12 }}>
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              background: profile.photoUrl ? 'transparent' : 'rgba(201,152,46,0.2)',
              border: `3px solid ${colors.gold}`,
              overflow: 'hidden', display: 'flex', alignItems: 'center',
              justifyContent: 'center',
            }}>
              {profile.photoUrl ? (
                <img src={profile.photoUrl} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 28, fontWeight: 700, color: colors.gold }}>
                  {driver?.firstName[0]}{driver?.lastName[0]}
                </span>
              )}
            </div>
            <label style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 26, height: 26, borderRadius: '50%',
              background: colors.gold, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 13, cursor: 'pointer',
              border: `2px solid ${colors.surfaceDark}`,
            }}>
              {uploadingPhoto ? '…' : '📷'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { void handlePhotoUpload(e); }} />
            </label>
          </div>
          <div className="heading-editorial heading-editorial-md on-dark">
            {driver?.firstName} {driver?.lastName}
          </div>
          {profile.memberSince && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
              Member since {formatDate(profile.memberSince)}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 16 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: colors.gold }}>
                {driver?.averageRating.toFixed(1)}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                {getStarDisplay(driver?.averageRating ?? 5)}
              </div>
            </div>
            <div style={{ width: 1, background: 'rgba(255,255,255,0.1)' }} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>
                {driver?.totalRidesCompleted ?? 0}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>Total Rides</div>
            </div>
            <div style={{ width: 1, background: 'rgba(255,255,255,0.1)' }} />
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>
                {((driver?.completionRate ?? 1) * 100).toFixed(0)}%
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>Completion</div>
            </div>
          </div>
        </div>

        {/* Bio */}
        <Card padding={16} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              About Me
            </div>
            {!editingBio && (
              <button
                onClick={() => setEditingBio(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: colors.gold, fontWeight: 600, fontFamily: 'inherit' }}
              >
                Edit
              </button>
            )}
          </div>
          {editingBio ? (
            <>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder="Tell members about yourself — experience, vehicle, specialties…"
                style={{
                  width: '100%', padding: '10px 12px',
                  border: `1px solid ${colors.border}`, borderRadius: borderRadius.sm,
                  background: colors.bgSecondary, fontSize: 13,
                  color: colors.navy, fontFamily: 'inherit', resize: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ fontSize: 11, color: colors.textMuted, textAlign: 'right', marginBottom: 10 }}>{bio.length}/500</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => { setEditingBio(false); setBio(profile.bio ?? ''); }}
                  style={{ flex: 1, padding: '10px 0', background: colors.bgSecondary, border: 'none', borderRadius: borderRadius.sm, fontSize: 13, fontWeight: 600, color: colors.textMuted, cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void handleSaveBio(); }}
                  disabled={saving}
                  style={{ flex: 1, padding: '10px 0', background: colors.navy, border: 'none', borderRadius: borderRadius.sm, fontSize: 13, fontWeight: 600, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 1.6 }}>
              {profile.bio ?? <span style={{ color: colors.textMuted, fontStyle: 'italic' }}>No bio yet. Tap Edit to add one.</span>}
            </div>
          )}
        </Card>

        {/* Vehicle info */}
        {profile.vehicle && (
          <Card padding={16} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
              My Vehicle
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                { label: 'Make', value: profile.vehicle.make },
                { label: 'Model', value: profile.vehicle.model },
                { label: 'Year', value: String(profile.vehicle.year) },
                { label: 'Color', value: profile.vehicle.color },
                { label: 'Plate', value: profile.vehicle.plate },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: colors.bgSecondary, padding: '10px 12px', borderRadius: borderRadius.sm }}>
                  <div style={{ fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy, marginTop: 2 }}>{value}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Refer & Earn quick action */}
        <Button
          onClick={() => navigate('/refer')}
          variant="primary"
          fullWidth
          size="md"
          style={{ marginBottom: 16 }}
        >
          💸 Refer & Earn
        </Button>

        {/* Achievements */}
        {milestones.length > 0 && (
          <Card padding={16} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
              Achievements
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {milestones.map((m) => (
                <div
                  key={m.id}
                  title={m.label}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '6px 12px', borderRadius: borderRadius.full,
                    background: 'rgba(201,168,76,0.12)',
                    border: `1px solid rgba(201,168,76,0.35)`,
                    fontSize: 12, fontWeight: 600, color: colors.navy,
                  }}
                >
                  <span style={{ fontSize: 15 }}>{m.icon}</span>
                  {m.label}
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Certifications */}
        <Card padding={16}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            Certifications
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <BgcBadge status={driver?.bgcStatus ?? 'not_started'} />
            <CertBadge
              label="Valid Driver's License"
              passed={!!driver?.licenseDocumentPath}
            />
            <CertBadge
              label="Vehicle Insurance"
              passed={!!driver?.insuranceDocumentPath}
            />
            {driver?.canDoRideshare && <CertBadge label="Rideshare Certified" passed />}
            {driver?.canDoDelivery && <CertBadge label="Delivery Certified" passed />}
            {driver?.canDriveMemberVehicle && <CertBadge label="Member Vehicle Authorized" passed />}
          </div>
        </Card>
      </div>
    </div>
  );
}

function CertBadge({ label, passed }: { label: string; passed: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px', borderRadius: borderRadius.sm,
      background: passed ? colors.successBg : colors.bgSecondary,
    }}>
      <span style={{ fontSize: 16 }}>{passed ? '✅' : '⬜'}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: passed ? colors.success : colors.textMuted }}>
        {label}
      </span>
    </div>
  );
}

function BgcBadge({ status }: { status: string }) {
  const cfg = {
    passed:      { bg: colors.successBg, color: colors.success,  icon: '✅', label: 'Background Check — Verified' },
    pending:     { bg: colors.warningBg, color: colors.warning,  icon: '🕐', label: 'Background Check — Pending' },
    failed:      { bg: colors.errorBg,   color: colors.error,    icon: '❌', label: 'Background Check — Failed' },
    not_started: { bg: colors.errorBg,   color: colors.error,    icon: '🛡️', label: 'Background Check — Required' },
  }[status] ?? { bg: colors.bgSecondary, color: colors.textMuted, icon: '⬜', label: 'Background Check' };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px', borderRadius: borderRadius.sm,
      background: cfg.bg,
    }}>
      <span style={{ fontSize: 16 }}>{cfg.icon}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: cfg.color }}>{cfg.label}</span>
    </div>
  );
}
