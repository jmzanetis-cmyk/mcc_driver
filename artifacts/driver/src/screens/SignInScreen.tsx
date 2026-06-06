// ============================================================
// MCC Driver — Sign In Screen
// ============================================================

import React, { useEffect, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { sendOTP, verifyOTP, sendEmailOTP, verifyEmailOTP } from '@/services/auth/authService';
import { Button, Input, Spinner } from '@/components';
import { OfflineNotice, isOffline } from '@/components/OfflineNotice';
import { colors, borderRadius } from '@/theme';

export function SignInScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [method, setMethod] = useState<'phone' | 'email'>('phone');
  const [step, setStep] = useState<'input' | 'code'>('input');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Persist ?from_founder and ?src from the /drive landing page or any deep link.
  // These are read by ApplicationScreen (src→acquisitionSource) and App.tsx
  // (from_founder→post-signup redirect into the founder enrollment flow).
  useEffect(() => {
    const fromFounder = searchParams.get('from_founder');
    const src = searchParams.get('src');
    try {
      if (fromFounder === '1') localStorage.setItem('mcc_driver_from_founder', '1');
      if (src) localStorage.setItem('mcc_driver_src', src);
    } catch { /* ignore quota errors */ }
  }, []);

  const switchMethod = (m: 'phone' | 'email') => {
    setMethod(m);
    setStep('input');
    setCode('');
    setError('');
  };

  const handleSendOTP = async () => {
    if (isOffline()) {
      setError("You're offline — connect to send a verification code.");
      return;
    }
    if (method === 'phone') {
      if (phone.replace(/\D/g, '').length < 10) { setError('Enter a valid phone number'); return; }
      setLoading(true); setError('');
      const formatted = phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`;
      const result = await sendOTP(formatted);
      setLoading(false);
      if (result.success) setStep('code');
      else setError(result.error || 'Failed to send code');
    } else {
      if (!email.includes('@') || !email.includes('.')) { setError('Enter a valid email address'); return; }
      setLoading(true); setError('');
      const result = await sendEmailOTP(email.trim().toLowerCase());
      setLoading(false);
      if (result.success) setStep('code');
      else setError(result.error || 'Failed to send code');
    }
  };

  const handleVerifyOTP = async () => {
    if (code.length < 6) { setError('Enter the 6-digit code'); return; }
    if (isOffline()) {
      setError("You're offline — connect to verify the code.");
      return;
    }
    setLoading(true); setError('');

    if (method === 'phone') {
      const formatted = phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`;
      const result = await verifyOTP(formatted, code);
      setLoading(false);
      if (result.success) {
        if (result.isNewDriver) navigate('/apply');
        else if (result.driverStatus === 'pending_approval') navigate('/pending');
        else if (result.driverStatus === 'suspended' || result.driverStatus === 'deactivated') navigate('/');
        else navigate('/home');
      } else {
        setError(result.error || 'Invalid code');
      }
    } else {
      const result = await verifyEmailOTP(email.trim().toLowerCase(), code);
      setLoading(false);
      if (result.success) {
        if (result.driverStatus === 'pending_approval') navigate('/pending');
        else if (result.driverStatus === 'suspended' || result.driverStatus === 'deactivated') navigate('/');
        else navigate('/home');
      } else {
        setError(result.error || 'Invalid code');
      }
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      justifyContent: 'center', padding: 24, background: '#04172F',
    }}>
      {/* Logo area */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <img
          src={`${import.meta.env.BASE_URL}mcc-driver-logo.png`}
          alt="My Car Concierge — Driver App"
          style={{ width: 220, height: 220, objectFit: 'contain', margin: '0 auto', display: 'block' }}
        />
      </div>

      {/* Form */}
      <div style={{
        background: colors.bgCard, borderRadius: borderRadius.lg,
        padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        <OfflineNotice style={{ marginBottom: 16 }} />

        {step === 'input' && (
          <div style={{
            display: 'flex', marginBottom: 20,
            border: `1px solid ${colors.border}`, borderRadius: borderRadius.md, overflow: 'hidden',
          }}>
            {(['phone', 'email'] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMethod(m)}
                style={{
                  flex: 1, padding: '9px 0', border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                  background: method === m ? colors.surfaceDark : 'transparent',
                  color: method === m ? colors.gold : colors.textMuted,
                  transition: 'all 0.15s',
                }}
              >
                {m === 'phone' ? 'Phone' : 'Email'}
              </button>
            ))}
          </div>
        )}

        {step === 'input' ? (
          <>
            <h2 className="heading-editorial heading-editorial-lg" style={{ marginBottom: 4 }}>
              Sign In
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
              {method === 'phone'
                ? 'Enter your phone number to receive a verification code'
                : 'Enter your email address to receive a verification code'}
            </p>
            {method === 'phone' ? (
              <Input
                label="Phone Number"
                value={phone}
                onChange={setPhone}
                type="tel"
                placeholder="(555) 123-4567"
                required
                error={error}
              />
            ) : (
              <Input
                label="Email Address"
                value={email}
                onChange={setEmail}
                type="email"
                placeholder="you@example.com"
                required
                error={error}
              />
            )}
            <Button onClick={handleSendOTP} loading={loading} fullWidth size="lg">
              Send Verification Code
            </Button>
          </>
        ) : (
          <>
            <h2 className="heading-editorial heading-editorial-lg" style={{ marginBottom: 4 }}>
              Enter Code
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
              We sent a 6-digit code to {method === 'phone' ? phone : email}
            </p>
            <Input
              label="Verification Code"
              value={code}
              onChange={setCode}
              type="text"
              placeholder="000000"
              required
              error={error}
            />
            <Button onClick={handleVerifyOTP} loading={loading} fullWidth size="lg">
              Verify & Sign In
            </Button>
            <Button
              onClick={() => { setStep('input'); setCode(''); setError(''); }}
              variant="ghost" fullWidth size="sm"
              style={{ marginTop: 12 }}
            >
              {method === 'phone' ? 'Use a different number' : 'Use a different email'}
            </Button>
          </>
        )}
      </div>

      {/* Partner code hint */}
      <p style={{
        textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.4)',
        marginTop: 24,
      }}>
        Have a partner invitation code? You'll enter it during sign-up.
      </p>

      {/* Legal footer — required by App Store Guideline 5.1.1 / EULA */}
      <p style={{
        textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.5)',
        marginTop: 16, lineHeight: 1.6,
      }}>
        By signing in you agree to our{' '}
        <Link to="/legal/terms" style={{ color: colors.gold, textDecoration: 'underline' }}>Terms</Link>
        {' '}and{' '}
        <Link to="/legal/privacy" style={{ color: colors.gold, textDecoration: 'underline' }}>Privacy Policy</Link>.
      </p>
    </div>
  );
}
