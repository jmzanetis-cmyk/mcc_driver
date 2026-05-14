// ============================================================
// MCC Driver — Driver Application Screen
// ============================================================

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createDriverApplication } from '@/services/auth/authService';
import { Button, Input, PageHeader } from '@/components';
import { colors, borderRadius } from '@/theme';

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  driversLicenseNumber: string;
  driversLicenseState: string;
  driversLicenseExpiry: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  vehicleColor: string;
  vehiclePlate: string;
  partnerInviteCode: string;
}

const INITIAL_FORM: FormData = {
  firstName: '', lastName: '', email: '', phone: '',
  dateOfBirth: '', driversLicenseNumber: '', driversLicenseState: 'NJ',
  driversLicenseExpiry: '', vehicleMake: '', vehicleModel: '',
  vehicleYear: '', vehicleColor: '', vehiclePlate: '', partnerInviteCode: '',
};

export function ApplicationScreen() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const totalSteps = 3;

  const update = (field: keyof FormData) => (value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    const result = await createDriverApplication({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      phone: form.phone,
      dateOfBirth: form.dateOfBirth,
      driversLicenseNumber: form.driversLicenseNumber,
      driversLicenseState: form.driversLicenseState,
      driversLicenseExpiry: form.driversLicenseExpiry,
      vehicleMake: form.vehicleMake || undefined,
      vehicleModel: form.vehicleModel || undefined,
      vehicleYear: form.vehicleYear ? parseInt(form.vehicleYear) : undefined,
      vehicleColor: form.vehicleColor || undefined,
      vehiclePlate: form.vehiclePlate || undefined,
      partnerInviteCode: form.partnerInviteCode || undefined,
    });

    setLoading(false);
    if (result.success) {
      navigate('/pending');
    } else {
      setError(result.error || 'Application failed');
    }
  };

  const canProceed = () => {
    if (step === 1) return form.firstName && form.lastName && form.email && form.dateOfBirth;
    if (step === 2) return form.driversLicenseNumber && form.driversLicenseExpiry;
    return true;
  };

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader
        title="Driver Application"
        subtitle={`Step ${step} of ${totalSteps}`}
        onBack={step > 1 ? () => setStep(step - 1) : undefined}
      />

      {/* Progress bar */}
      <div style={{ height: 4, background: colors.bgSecondary }}>
        <div style={{
          height: '100%', background: colors.gold,
          width: `${(step / totalSteps) * 100}%`,
          transition: 'width 0.3s ease',
        }} />
      </div>

      <div style={{ padding: 24 }} className="scroll-container">
        {step === 1 && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
              Personal Information
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
              We need some basic info to get started
            </p>
            <Input label="First Name" value={form.firstName} onChange={update('firstName')} required />
            <Input label="Last Name" value={form.lastName} onChange={update('lastName')} required />
            <Input label="Email" value={form.email} onChange={update('email')} type="email" required />
            <Input label="Phone" value={form.phone} onChange={update('phone')} type="tel" />
            <Input label="Date of Birth" value={form.dateOfBirth} onChange={update('dateOfBirth')} type="date" required />
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
              Driver's License
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
              You must be at least 21 years old with a valid license
            </p>
            <Input label="License Number" value={form.driversLicenseNumber} onChange={update('driversLicenseNumber')} required />
            <Input label="License State" value={form.driversLicenseState} onChange={update('driversLicenseState')} required />
            <Input label="License Expiry" value={form.driversLicenseExpiry} onChange={update('driversLicenseExpiry')} type="date" required />

            <div style={{ marginTop: 24, padding: 16, background: colors.bgSecondary, borderRadius: borderRadius.md }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy, marginBottom: 8 }}>
                Your Vehicle (optional for now)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Input label="Make" value={form.vehicleMake} onChange={update('vehicleMake')} />
                <Input label="Model" value={form.vehicleModel} onChange={update('vehicleModel')} />
                <Input label="Year" value={form.vehicleYear} onChange={update('vehicleYear')} type="number" />
                <Input label="Color" value={form.vehicleColor} onChange={update('vehicleColor')} />
              </div>
              <Input label="License Plate" value={form.vehiclePlate} onChange={update('vehiclePlate')} />
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
              Almost Done
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
              Review your info and submit your application
            </p>

            <Input
              label="Partner Invitation Code (optional)"
              value={form.partnerInviteCode}
              onChange={update('partnerInviteCode')}
              placeholder="Enter code if you have one"
            />

            {/* Summary */}
            <div style={{ background: colors.bgSecondary, borderRadius: borderRadius.md, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Application Summary</div>
              <div style={{ fontSize: 14, color: colors.textPrimary, lineHeight: 1.8 }}>
                <strong>{form.firstName} {form.lastName}</strong><br />
                {form.email}<br />
                License: {form.driversLicenseState} — {form.driversLicenseNumber}<br />
                {form.vehicleMake && `Vehicle: ${form.vehicleYear} ${form.vehicleColor} ${form.vehicleMake} ${form.vehicleModel}`}
                {form.vehiclePlate && ` (${form.vehiclePlate})`}
              </div>
            </div>

            <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.6, marginBottom: 20 }}>
              By submitting, you consent to a background check and driving record review through BackgroundChecks.com. You must be at least 21 years old with a valid driver's license.
            </div>

            {error && (
              <div style={{ padding: 12, background: colors.errorBg, borderRadius: borderRadius.sm, color: colors.error, fontSize: 13, marginBottom: 16 }}>
                {error}
              </div>
            )}
          </>
        )}

        {/* Navigation buttons */}
        <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
          {step < totalSteps ? (
            <Button onClick={() => setStep(step + 1)} disabled={!canProceed()} fullWidth size="lg">
              Continue
            </Button>
          ) : (
            <Button onClick={handleSubmit} loading={loading} fullWidth size="lg">
              Submit Application
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
