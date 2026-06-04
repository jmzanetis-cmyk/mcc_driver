// ============================================================
// MCC Driver — Refer & Earn Screen
// ============================================================

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { supabase } from '@/services/supabase/client';
import { PageHeader, Card, Button, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { apiUrl } from '@/services/api/baseUrl';

type Mode = 'provider' | 'driver';

interface ReferralData {
  referralCode: string;
  providerSignupUrl: string;
  driverSignupUrl: string;
}

async function generateQR(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    width: 220,
    margin: 2,
    color: { dark: '#1B2A4A', light: '#FAF7F0' },
  });
}

export function ReferAndEarnScreen() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('provider');
  const [data, setData] = useState<ReferralData | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(apiUrl('/drivers/me/referral'), {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (!res.ok) throw new Error('Could not load referral info');
        const json = await res.json() as ReferralData;
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load referral code');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activeUrl = data ? (mode === 'provider' ? data.providerSignupUrl : data.driverSignupUrl) : '';

  useEffect(() => {
    if (!activeUrl) return;
    void generateQR(activeUrl).then(setQrDataUrl);
  }, [activeUrl]);

  const handleCopy = async () => {
    if (!activeUrl) return;
    await navigator.clipboard.writeText(activeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!activeUrl || !data) return;
    const title = mode === 'provider'
      ? 'Join MCC as a Service Provider'
      : 'Drive with My Car Concierge';
    const text = mode === 'provider'
      ? `${title} — a premium concierge platform for luxury automotive clients.`
      : `${title} — premium, respectful driving jobs. Refer code: ${data.referralCode}`;
    if (navigator.share) {
      await navigator.share({ title, text, url: activeUrl }).catch(() => {});
    } else {
      await handleCopy();
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Refer & Earn" onBack={() => navigate('/settings')} />

      <div style={{ padding: 20 }}>
        {/* Mode toggle */}
        <div style={{
          display: 'flex', background: colors.bgSecondary,
          borderRadius: borderRadius.md, padding: 4, marginBottom: 20,
        }}>
          {([
            { key: 'provider' as Mode, label: '🏪 Refer a Provider' },
            { key: 'driver'   as Mode, label: '🚗 Refer a Driver' },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              style={{
                flex: 1, padding: '11px 0', border: 'none', cursor: 'pointer',
                borderRadius: borderRadius.sm, fontSize: 13, fontWeight: 600,
                background: mode === key ? colors.bgCard : 'transparent',
                color: mode === key ? colors.navy : colors.textMuted,
                boxShadow: mode === key ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                transition: 'all 0.15s', fontFamily: 'inherit',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Value prop */}
        <Card padding={16} style={{ marginBottom: 20, border: `1px solid ${colors.gold}`, background: 'rgba(201,168,76,0.06)' }}>
          <div style={{ fontSize: 13, color: colors.navy, lineHeight: 1.6 }}>
            {mode === 'provider' ? (
              <>
                <strong style={{ color: colors.gold }}>Refer a shop, garage, or dealership</strong> you visit on a job.
                {' '}Earn commission when they join the MCC provider network.
              </>
            ) : (
              <>
                <strong style={{ color: colors.gold }}>Refer a driver you trust.</strong>
                {' '}Earn a bonus when they complete their first rides on the platform.
              </>
            )}
          </div>
        </Card>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}><Spinner /></div>
        ) : error ? (
          <Card padding={24}>
            <div style={{ textAlign: 'center', color: colors.error, fontSize: 14 }}>{error}</div>
          </Card>
        ) : data ? (
          <>
            {/* QR Code */}
            <Card padding={24} style={{ marginBottom: 16, textAlign: 'center' }}>
              <div style={{
                fontSize: 11, fontWeight: 700, color: colors.textMuted,
                textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16,
              }}>
                {mode === 'provider' ? 'Provider Signup QR' : 'Driver Signup QR'}
              </div>
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Referral QR code"
                  style={{
                    width: 220, height: 220, borderRadius: borderRadius.md,
                    margin: '0 auto', display: 'block',
                    border: `3px solid ${colors.gold}`,
                  }}
                />
              ) : (
                <div style={{ width: 220, height: 220, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Spinner />
                </div>
              )}
              <div style={{
                marginTop: 14, fontSize: 11, color: colors.textMuted,
                fontFamily: 'monospace', background: colors.bgSecondary,
                padding: '6px 12px', borderRadius: borderRadius.full,
                display: 'inline-block',
              }}>
                Code: {data.referralCode}
              </div>
            </Card>

            {/* Link display */}
            <Card padding={14} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Referral Link
              </div>
              <div style={{
                fontSize: 12, color: colors.navy, wordBreak: 'break-all',
                fontFamily: 'monospace', lineHeight: 1.5,
              }}>
                {activeUrl}
              </div>
            </Card>

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Button
                onClick={() => void handleShare()}
                variant="primary"
                fullWidth
                size="lg"
              >
                {typeof navigator !== 'undefined' && 'share' in navigator ? '↑ Share Link' : '↑ Share / Copy'}
              </Button>
              <Button
                onClick={() => void handleCopy()}
                variant="secondary"
                fullWidth
                size="md"
              >
                {copied ? '✓ Copied!' : '⎘ Copy Link'}
              </Button>
              {qrDataUrl && (
                <Button
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = qrDataUrl;
                    a.download = `mcc-referral-${mode}-${data.referralCode}.png`;
                    a.click();
                  }}
                  variant="ghost"
                  fullWidth
                  size="md"
                >
                  ↓ Download QR Code
                </Button>
              )}
            </div>

            {mode === 'provider' && (
              <div style={{
                marginTop: 12, fontSize: 11, color: colors.textMuted, lineHeight: 1.5,
                padding: '8px 12px', background: colors.bgSecondary, borderRadius: borderRadius.sm,
              }}>
                <strong>Disclosure:</strong> you earn a commission when referred providers purchase bid credits. Providers are informed of this relationship at signup.
              </div>
            )}

            {/* How it works */}
            <div style={{ marginTop: 28 }}>
              <div style={{
                fontSize: 12, fontWeight: 700, color: colors.textMuted,
                textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12,
              }}>
                How it works
              </div>
              {(mode === 'provider' ? [
                { icon: '🏪', text: 'Show or send your QR to a shop, garage, or dealership' },
                { icon: '✅', text: 'They sign up as an MCC provider using your code' },
                { icon: '💰', text: 'You earn a commission when they join the network' },
              ] : [
                { icon: '🚗', text: 'Share your link with a driver you want to refer' },
                { icon: '📋', text: 'They apply and complete their first rides' },
                { icon: '💰', text: 'You earn a bonus once they\'re active' },
              ]).map(({ icon, text }, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5 }}>{text}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
