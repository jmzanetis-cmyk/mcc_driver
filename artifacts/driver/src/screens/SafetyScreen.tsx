// ============================================================
// MCC Driver — Safety Screen
// ============================================================

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useDriverStatusStore } from '@/store/driverStatusStore';
import { useDispatchStore } from '@/store/dispatchStore';
import { PageHeader, Card } from '@/components';
import { colors, borderRadius } from '@/theme';
import { apiUrl } from '@/services/api/baseUrl';
import { supabase } from '@/services/supabase/client';

export function SafetyScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const currentLat = useDriverStatusStore((s) => s.currentLat);
  const currentLng = useDriverStatusStore((s) => s.currentLng);
  const rideId = useDispatchStore((s) => s.rideId);

  const [panicSent, setPanicSent] = useState(false);
  const [panicLoading, setPanicLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactSaving, setContactSaving] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  };

  const handlePanic = async () => {
    if (panicSent || panicLoading) return;
    setPanicLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(apiUrl('/safety/alert'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ lat: currentLat, lng: currentLng, rideId }),
      });
      if (res.ok) {
        setPanicSent(true);
      } else {
        const j = await res.json() as { error?: string };
        setError(j.error ?? 'Failed to send alert');
      }
    } catch {
      setError('Network error. Try calling 911 directly.');
    } finally {
      setPanicLoading(false);
    }
  };

  const handleShareTrip = async () => {
    setShareLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(apiUrl('/safety/share-trip'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rideId }),
      });
      if (res.ok) {
        const j = await res.json() as { shareUrl?: string };
        setShareUrl(j.shareUrl ?? null);
      } else {
        setError('Failed to generate share link');
      }
    } catch {
      setError('Network error');
    } finally {
      setShareLoading(false);
    }
  };

  const handleSaveContact = async () => {
    if (!contactName.trim() || !contactPhone.trim()) return;
    setContactSaving(true);
    setError(null);
    try {
      const token = await getToken();
      await fetch(apiUrl('/safety/emergency-contact'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: contactName.trim(), phone: contactPhone.trim() }),
      });
      setContactSaved(true);
      setTimeout(() => setContactSaved(false), 2000);
    } catch {
      setError('Failed to save contact');
    } finally {
      setContactSaving(false);
    }
  };

  const handleCopyLink = () => {
    if (shareUrl) void navigator.clipboard.writeText(shareUrl);
  };

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Safety" onBack={() => navigate('/home')} />

      <div style={{ padding: 20 }}>
        {/* Panic Button */}
        <Card padding={24} style={{ marginBottom: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16 }}>
            Emergency Alert
          </div>
          {panicSent ? (
            <div>
              <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: colors.success, marginBottom: 8 }}>
                Alert Sent
              </div>
              <div style={{ fontSize: 13, color: colors.textMuted }}>
                Your emergency contact has been notified. If you are in immediate danger, call 911.
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={() => { void handlePanic(); }}
                disabled={panicLoading}
                style={{
                  width: 120, height: 120, borderRadius: '50%',
                  background: panicLoading ? colors.textMuted : '#DC2626',
                  border: '6px solid #FCA5A5',
                  color: '#fff', fontSize: 32, cursor: panicLoading ? 'default' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'inherit', fontWeight: 700,
                  boxShadow: '0 0 0 4px rgba(220,38,38,0.2)',
                  transition: 'all 0.15s',
                }}
              >
                {panicLoading ? '...' : '🆘'}
              </button>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#DC2626', marginTop: 12 }}>
                Tap to Send Emergency Alert
              </div>
              <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
                Sends your GPS location to your emergency contact via SMS
              </div>
            </>
          )}
        </Card>

        {/* Share Trip */}
        <Card padding={16} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            Share Trip
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, marginBottom: 12 }}>
            Generate a link that shows your live location to anyone you share it with.
          </div>
          {shareUrl ? (
            <div>
              <div style={{
                background: colors.bgSecondary, borderRadius: borderRadius.sm,
                padding: '10px 12px', marginBottom: 10,
                fontSize: 12, color: colors.navy, wordBreak: 'break-all',
              }}>
                {shareUrl}
              </div>
              <button
                onClick={handleCopyLink}
                style={{
                  width: '100%', padding: '10px 0',
                  background: colors.surfaceDark, color: '#fff',
                  border: 'none', borderRadius: borderRadius.md,
                  fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Copy Link
              </button>
            </div>
          ) : (
            <button
              onClick={() => { void handleShareTrip(); }}
              disabled={shareLoading}
              style={{
                width: '100%', padding: '12px 0',
                background: colors.surfaceDark, color: '#fff',
                border: 'none', borderRadius: borderRadius.md,
                fontSize: 14, fontWeight: 600, cursor: shareLoading ? 'default' : 'pointer',
                fontFamily: 'inherit', opacity: shareLoading ? 0.7 : 1,
              }}
            >
              {shareLoading ? 'Generating…' : '🔗 Generate Share Link'}
            </button>
          )}
        </Card>

        {/* Emergency Contact */}
        <Card padding={16} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            Emergency Contact
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Contact name"
              style={{
                padding: '10px 12px', borderRadius: borderRadius.sm,
                border: `1px solid ${colors.border}`, background: colors.bgSecondary,
                fontSize: 14, color: colors.navy, fontFamily: 'inherit',
              }}
            />
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              type="tel"
              style={{
                padding: '10px 12px', borderRadius: borderRadius.sm,
                border: `1px solid ${colors.border}`, background: colors.bgSecondary,
                fontSize: 14, color: colors.navy, fontFamily: 'inherit',
              }}
            />
            <button
              onClick={() => { void handleSaveContact(); }}
              disabled={contactSaving || !contactName.trim() || !contactPhone.trim()}
              style={{
                padding: '10px 0', background: contactSaved ? colors.success : colors.navy,
                color: '#fff', border: 'none', borderRadius: borderRadius.sm,
                fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                transition: 'background 0.2s',
              }}
            >
              {contactSaved ? '✓ Saved' : contactSaving ? 'Saving…' : 'Save Contact'}
            </button>
          </div>
        </Card>

        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: borderRadius.sm,
            background: colors.errorBg, color: colors.error,
            fontSize: 13, marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        {/* Emergency info */}
        <Card padding={14}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            Emergency Resources
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <a
              href="tel:911"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', background: '#FEF2F2',
                borderRadius: borderRadius.sm, textDecoration: 'none',
              }}
            >
              <span style={{ fontSize: 20 }}>🚨</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#DC2626' }}>Call 911</div>
                <div style={{ fontSize: 11, color: colors.textMuted }}>Emergency services</div>
              </div>
            </a>
            <a
              href="tel:18002221222"
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', background: colors.bgSecondary,
                borderRadius: borderRadius.sm, textDecoration: 'none',
              }}
            >
              <span style={{ fontSize: 20 }}>☎️</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>Poison Control</div>
                <div style={{ fontSize: 11, color: colors.textMuted }}>1-800-222-1222</div>
              </div>
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}
