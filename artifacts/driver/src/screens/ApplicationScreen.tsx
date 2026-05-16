// ============================================================
// MCC Driver — Driver Application Screen
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createDriverApplication } from '@/services/auth/authService';
import { uploadDriverDocument, type DocumentType } from '@/services/documents/documentService';
import { supabase } from '@/services/supabase/client';
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

const DRAFT_KEY = 'mcc_driver_application_draft';

function loadDraft(): FormData {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return INITIAL_FORM;
    const parsed = JSON.parse(raw) as Partial<FormData>;
    return { ...INITIAL_FORM, ...parsed };
  } catch {
    return INITIAL_FORM;
  }
}

function saveDraft(data: FormData) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch {
    // ignore storage errors (e.g. private browsing quota)
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

interface FileState {
  file: File | null;
  preview: string | null;
  uploading: boolean;
  /** Storage path in the private bucket — not a public URL */
  path: string | null;
  error: string | null;
}

const EMPTY_FILE: FileState = { file: null, preview: null, uploading: false, path: null, error: null };

function FileUploadField({
  label,
  hint,
  state,
  onSelect,
  required,
}: {
  label: string;
  hint: string;
  state: FileState;
  onSelect: (file: File) => void;
  required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
        {label}{required && <span style={{ color: colors.error }}> *</span>}
      </div>
      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>{hint}</div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onSelect(file);
        }}
      />

      {state.preview ? (
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <img
            src={state.preview}
            alt={label}
            style={{
              width: '100%', maxHeight: 140, objectFit: 'cover',
              borderRadius: borderRadius.sm, border: `1px solid ${colors.border}`,
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="btn btn-secondary btn-sm"
            style={{
              position: 'absolute', bottom: 8, right: 8,
            }}
          >
            Change
          </button>
          {state.path && (
            <div style={{
              position: 'absolute', top: 8, right: 8,
              background: colors.success, color: '#fff',
              borderRadius: 999, fontSize: 11, padding: '3px 8px',
            }}>
              ✓ Uploaded
            </div>
          )}
        </div>
      ) : state.file && !state.preview ? (
        <div style={{
          padding: 12,
          background: '#FFF3E0',
          border: `1px solid #FFB74D`,
          borderRadius: borderRadius.sm,
          fontSize: 13, color: colors.textPrimary, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 2, flexShrink: 0,
          }}>
            <span style={{ fontSize: 18 }}>📄</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: '#E65100', letterSpacing: '0.05em' }}>PDF</span>
          </div>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {state.file.name}
          </span>
          {state.path && <span style={{ color: colors.success, fontWeight: 600 }}>✓</span>}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          style={{
            width: '100%', padding: '20px 16px',
            border: `2px dashed var(--border-medium)`,
            borderRadius: borderRadius.md, background: colors.bgSecondary,
            cursor: 'pointer', textAlign: 'center',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            color: colors.textPrimary, fontFamily: 'inherit',
          }}
        >
          <span style={{ fontSize: 24 }}>📷</span>
          <span style={{ fontSize: 13, color: colors.textPrimary, fontWeight: 500 }}>
            Tap to upload
          </span>
          <span style={{ fontSize: 11, color: colors.textMuted }}>
            JPG, PNG or PDF
          </span>
        </button>
      )}

      {state.uploading && (
        <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }}>Uploading…</div>
      )}
      {state.error && (
        <div style={{ fontSize: 12, color: colors.error, marginTop: 6 }}>{state.error}</div>
      )}
    </div>
  );
}

export function ApplicationScreen() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(loadDraft);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [licenseDoc, setLicenseDoc] = useState<FileState>(EMPTY_FILE);
  const [insuranceDoc, setInsuranceDoc] = useState<FileState>(EMPTY_FILE);

  const totalSteps = 3;

  useEffect(() => {
    saveDraft(form);
  }, [form]);

  const update = (field: keyof FormData) => (value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const handleFileSelect = async (
    file: File,
    docType: 'license' | 'insurance',
    setter: React.Dispatch<React.SetStateAction<FileState>>,
  ) => {
    const isImage = file.type.startsWith('image/');
    const nextPreview = isImage ? URL.createObjectURL(file) : null;

    setter(prev => {
      if (prev.preview) URL.revokeObjectURL(prev.preview);
      return { file, preview: nextPreview, uploading: true, path: null, error: null };
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setter(prev => ({ ...prev, uploading: false, error: 'Not authenticated' }));
      return;
    }

    const result = await uploadDriverDocument(user.id, docType, file);
    if (result.success && result.path) {
      setter(prev => ({ ...prev, uploading: false, path: result.path! }));
    } else {
      setter(prev => ({ ...prev, uploading: false, error: result.error ?? 'Upload failed' }));
    }
  };

  // Refs always hold the latest preview URLs so the unmount cleanup
  // isn't bound by a stale closure (the [] dependency captures nothing).
  const licensePreviewRef = useRef<string | null>(null);
  const insurancePreviewRef = useRef<string | null>(null);
  licensePreviewRef.current = licenseDoc.preview;
  insurancePreviewRef.current = insuranceDoc.preview;

  useEffect(() => {
    return () => {
      if (licensePreviewRef.current) URL.revokeObjectURL(licensePreviewRef.current);
      if (insurancePreviewRef.current) URL.revokeObjectURL(insurancePreviewRef.current);
    };
  }, []);

  const handleSubmit = async () => {
    if (!licenseDoc.path) {
      setError("Please upload your driver's license photo before submitting.");
      return;
    }
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
      licenseDocumentPath: licenseDoc.path ?? undefined,
      insuranceDocumentPath: insuranceDoc.path ?? undefined,
      partnerInviteCode: form.partnerInviteCode || undefined,
    });

    setLoading(false);
    if (result.success) {
      clearDraft();
      navigate('/pending');
    } else {
      setError(result.error || 'Application failed');
    }
  };

  const canProceed = () => {
    if (step === 1) return form.firstName && form.lastName && form.email && form.dateOfBirth;
    if (step === 2) {
      const licenseInfoComplete = form.driversLicenseNumber && form.driversLicenseExpiry;
      const anyUploading = licenseDoc.uploading || insuranceDoc.uploading;
      return licenseInfoComplete && !anyUploading;
    }
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
              Driver's License & Documents
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
              You must be at least 21 years old with a valid license
            </p>
            <Input label="License Number" value={form.driversLicenseNumber} onChange={update('driversLicenseNumber')} required />
            <Input label="License State" value={form.driversLicenseState} onChange={update('driversLicenseState')} required />
            <Input label="License Expiry" value={form.driversLicenseExpiry} onChange={update('driversLicenseExpiry')} type="date" required />

            <FileUploadField
              label="Driver's License Photo"
              hint="Front of your license — must be clear and legible"
              state={licenseDoc}
              onSelect={(file) => handleFileSelect(file, 'license', setLicenseDoc)}
              required
            />

            <FileUploadField
              label="Proof of Insurance"
              hint="Current insurance card or policy document"
              state={insuranceDoc}
              onSelect={(file) => handleFileSelect(file, 'insurance', setInsuranceDoc)}
            />

            <div style={{ marginTop: 8, padding: 16, background: colors.bgSecondary, borderRadius: borderRadius.md }}>
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

            {/* Document upload status */}
            <div style={{ background: colors.bgSecondary, borderRadius: borderRadius.md, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Documents</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ color: licenseDoc.path ? colors.success : colors.textMuted }}>
                    {licenseDoc.path ? '✓' : '○'}
                  </span>
                  <span style={{ color: licenseDoc.path ? colors.textPrimary : colors.textMuted }}>
                    Driver's License Photo {licenseDoc.path ? 'uploaded' : '(not uploaded)'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ color: insuranceDoc.path ? colors.success : colors.textMuted }}>
                    {insuranceDoc.path ? '✓' : '○'}
                  </span>
                  <span style={{ color: insuranceDoc.path ? colors.textPrimary : colors.textMuted }}>
                    Proof of Insurance {insuranceDoc.path ? 'uploaded' : '(not uploaded)'}
                  </span>
                </div>
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

        {/* Ride-Along Driver alternative path */}
        {step === 1 && (
          <div style={{
            marginTop: 28, paddingTop: 20,
            borderTop: `1px solid ${colors.border}`,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 8 }}>
              Not an MCC provider driver?
            </div>
            <button
              type="button"
              onClick={() => navigate('/ride-along-apply')}
              className="btn btn-ghost btn-sm"
              style={{
                color: colors.gold, textDecoration: 'underline',
                boxShadow: 'none',
              }}
            >
              Apply as a Ride-Along Driver instead →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
