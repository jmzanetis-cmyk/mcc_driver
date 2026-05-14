// ============================================================
// MCC Driver — Sign In Screen
// ============================================================

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sendOTP, verifyOTP } from '@/services/auth/authService';
import { Button, Input, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';

export function SignInScreen() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendOTP = async () => {
    if (phone.length < 10) {
      setError('Enter a valid phone number');
      return;
    }
    setLoading(true);
    setError('');

    const formatted = phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`;
    const result = await sendOTP(formatted);

    setLoading(false);
    if (result.success) {
      setStep('code');
    } else {
      setError(result.error || 'Failed to send code');
    }
  };

  const handleVerifyOTP = async () => {
    if (code.length < 6) {
      setError('Enter the 6-digit code');
      return;
    }
    setLoading(true);
    setError('');

    const formatted = phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`;
    const result = await verifyOTP(formatted, code);

    setLoading(false);
    if (result.success) {
      if (result.isNewDriver) {
        navigate('/apply');
      } else if (result.driverStatus === 'pending_approval') {
        navigate('/pending');
      } else if (result.driverStatus === 'suspended' || result.driverStatus === 'deactivated') {
        navigate('/');
      } else {
        navigate('/home');
      }
    } else {
      setError(result.error || 'Invalid code');
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      justifyContent: 'center', padding: 24, background: colors.navy,
    }}>
      {/* Logo area */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <img
          src="/driver/mcc-driver-logo.png"
          alt="My Car Concierge — Driver App"
          style={{ width: 220, height: 220, objectFit: 'contain', margin: '0 auto', display: 'block' }}
        />
      </div>

      {/* Form */}
      <div style={{
        background: colors.bgCard, borderRadius: borderRadius.lg,
        padding: 24, boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
      }}>
        {step === 'phone' ? (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
              Sign In
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
              Enter your phone number to receive a verification code
            </p>
            <Input
              label="Phone Number"
              value={phone}
              onChange={setPhone}
              type="tel"
              placeholder="(555) 123-4567"
              required
              error={error}
            />
            <Button onClick={handleSendOTP} loading={loading} fullWidth size="lg">
              Send Verification Code
            </Button>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
              Enter Code
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
              We sent a 6-digit code to {phone}
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
              onClick={() => { setStep('phone'); setCode(''); setError(''); }}
              variant="ghost" fullWidth size="sm"
              style={{ marginTop: 12 }}
            >
              Use a different number
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
    </div>
  );
}
