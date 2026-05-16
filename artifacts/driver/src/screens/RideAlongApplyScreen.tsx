// ============================================================
// MCC Driver — Ride-Along Driver Application Screen
// ============================================================
// Multi-step onboarding for the Ride-Along Driver gig role.
// Step 1: Personal info (name, phone, email, zip, max distance)
// Step 2: License info + document uploads (license + insurance)
// Step 3: Profile photo upload
// Step 4: Ride-Along Driver Agreement acknowledgment + submit
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/services/supabase/client';
import { uploadDriverDocument } from '@/services/documents/documentService';
import { Button, Input, PageHeader } from '@/components';
import { OfflineNotice, isOffline } from '@/components/OfflineNotice';
import { colors, borderRadius, withAlpha } from '@/theme';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  zipCode: string;
  maxDistanceMiles: string;
  licenseNumber: string;
  licenseState: string;
  licenseExpiry: string;
  insuranceExpiry: string;
}

const INITIAL_FORM: FormData = {
  firstName: '', lastName: '', email: '', phone: '',
  zipCode: '', maxDistanceMiles: '20',
  licenseNumber: '', licenseState: 'NJ', licenseExpiry: '',
  insuranceExpiry: '',
};

interface FileState {
  file: File | null;
  preview: string | null;
  uploading: boolean;
  path: string | null;
  error: string | null;
}

const EMPTY_FILE: FileState = { file: null, preview: null, uploading: false, path: null, error: null };

function FileUploadField({
  label, hint, state, onSelect, required,
}: {
  label: string; hint: string; state: FileState;
  onSelect: (file: File) => void; required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
        {label}{required && <span style={{ color: colors.error }}> *</span>}
      </div>
      <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>{hint}</div>
      <input ref={inputRef} type="file" accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onSelect(f); }}
      />
      {state.preview ? (
        <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
          <img src={state.preview} alt={label} style={{
            width: '100%', maxHeight: 140, objectFit: 'cover',
            borderRadius: borderRadius.sm, border: `1px solid ${colors.border}`,
          }} />
          <button onClick={() => inputRef.current?.click()} style={{
            position: 'absolute', bottom: 8, right: 8,
            background: 'rgba(0,0,0,0.6)', color: '#fff',
            border: 'none', borderRadius: borderRadius.sm, fontSize: 11, padding: '4px 8px', cursor: 'pointer',
          }}>Change</button>
          {state.path && (
            <div style={{
              position: 'absolute', top: 8, right: 8,
              background: colors.success, color: '#fff', borderRadius: 999, fontSize: 11, padding: '3px 8px',
            }}>✓ Uploaded</div>
          )}
        </div>
      ) : state.file && !state.preview ? (
        <div style={{
          padding: 12, background: '#FFF3E0', border: '1px solid #FFB74D',
          borderRadius: borderRadius.sm, fontSize: 13, color: colors.textPrimary,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>📄</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {state.file.name}
          </span>
          {state.path && <span style={{ color: colors.success, fontWeight: 600 }}>✓</span>}
        </div>
      ) : (
        <button onClick={() => inputRef.current?.click()} style={{
          width: '100%', padding: '20px 16px',
          border: `2px dashed ${colors.border}`, borderRadius: borderRadius.md,
          background: colors.bgSecondary, cursor: 'pointer', textAlign: 'center',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        }}>
          <span style={{ fontSize: 24 }}>📷</span>
          <span style={{ fontSize: 13, color: colors.textPrimary, fontWeight: 500 }}>Tap to upload</span>
          <span style={{ fontSize: 11, color: colors.textMuted }}>JPG, PNG or PDF</span>
        </button>
      )}
      {state.uploading && <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }}>Uploading…</div>}
      {state.error && <div style={{ fontSize: 12, color: colors.error, marginTop: 6 }}>{state.error}</div>}
    </div>
  );
}

export function RideAlongApplyScreen() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [agreementChecked, setAgreementChecked] = useState(false);
  const [licenseDoc, setLicenseDoc] = useState<FileState>(EMPTY_FILE);
  const [insuranceDoc, setInsuranceDoc] = useState<FileState>(EMPTY_FILE);
  const [profilePhoto, setProfilePhoto] = useState<FileState>(EMPTY_FILE);

  const TOTAL_STEPS = 4;

  const update = (field: keyof FormData) => (value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const handleFileSelect = async (
    file: File,
    docType: 'license' | 'insurance' | 'profile_photo',
    setter: React.Dispatch<React.SetStateAction<FileState>>,
  ) => {
    const isImage = file.type.startsWith('image/');
    const preview = isImage ? URL.createObjectURL(file) : null;
    setter(prev => {
      if (prev.preview) URL.revokeObjectURL(prev.preview);
      return { file, preview, uploading: true, path: null, error: null };
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setter(prev => ({ ...prev, uploading: false, error: 'Not authenticated' }));
      return;
    }

    const uploadDocType = docType === 'profile_photo' ? 'license' : docType;
    const storagePath = docType === 'profile_photo'
      ? `${user.id}/rad_profile_photo.${file.name.split('.').pop() ?? 'jpg'}`
      : null;

    if (storagePath) {
      const { error: uploadError } = await supabase.storage
        .from('driver-documents')
        .upload(storagePath, file, { upsert: true, contentType: file.type });
      if (uploadError) {
        setter(prev => ({ ...prev, uploading: false, error: uploadError.message }));
      } else {
        setter(prev => ({ ...prev, uploading: false, path: storagePath }));
      }
    } else {
      const result = await uploadDriverDocument(user.id, uploadDocType, file);
      if (result.success && result.path) {
        setter(prev => ({ ...prev, uploading: false, path: result.path! }));
      } else {
        setter(prev => ({ ...prev, uploading: false, error: result.error ?? 'Upload failed' }));
      }
    }
  };

  const licensePreviewRef = useRef<string | null>(null);
  const insurancePreviewRef = useRef<string | null>(null);
  const photoPreviewRef = useRef<string | null>(null);
  licensePreviewRef.current = licenseDoc.preview;
  insurancePreviewRef.current = insuranceDoc.preview;
  photoPreviewRef.current = profilePhoto.preview;

  useEffect(() => {
    return () => {
      if (licensePreviewRef.current) URL.revokeObjectURL(licensePreviewRef.current);
      if (insurancePreviewRef.current) URL.revokeObjectURL(insurancePreviewRef.current);
      if (photoPreviewRef.current) URL.revokeObjectURL(photoPreviewRef.current);
    };
  }, []);

  const canProceed = () => {
    if (step === 1) return !!(form.firstName && form.lastName && form.email && form.phone);
    if (step === 2) {
      return !!(
        form.licenseNumber &&
        form.licenseExpiry &&
        licenseDoc.path &&
        form.insuranceExpiry &&
        insuranceDoc.path &&
        !licenseDoc.uploading &&
        !insuranceDoc.uploading
      );
    }
    if (step === 3) return !profilePhoto.uploading;
    if (step === 4) return agreementChecked;
    return true;
  };

  const handleSubmit = async () => {
    if (!agreementChecked) {
      setError('Please acknowledge the Ride-Along Driver Agreement before submitting.');
      return;
    }
    if (!licenseDoc.path) {
      setError("Please upload your driver's license before submitting.");
      return;
    }
    if (isOffline()) {
      setError("You're offline — connect to submit your application. Your progress is saved.");
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Not authenticated. Please sign in again.');
        setLoading(false);
        return;
      }

      const payload = {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        zipCode: form.zipCode || undefined,
        maxDistanceMiles: parseInt(form.maxDistanceMiles) || 20,
        licenseNumber: form.licenseNumber || undefined,
        licenseState: form.licenseState || undefined,
        licenseExpiry: form.licenseExpiry || undefined,
        licenseDocumentPath: licenseDoc.path || undefined,
        insuranceDocumentPath: insuranceDoc.path || undefined,
        insuranceExpiry: form.insuranceExpiry || undefined,
        profilePhotoPath: profilePhoto.path || undefined,
        agreementSigned: true,
      };

      const res = await fetch(`${BASE}/api/ride-along-drivers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json() as { error?: string; id?: string };
      if (!res.ok) {
        if (res.status === 409) {
          navigate('/ride-along-pending');
          return;
        }
        setError(data.error ?? 'Submission failed');
        setLoading(false);
        return;
      }

      navigate('/ride-along-pending');
    } catch {
      setError('Network error — please try again.');
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader
        title="Ride-Along Driver"
        subtitle={`Step ${step} of ${TOTAL_STEPS}`}
        onBack={step > 1 ? () => setStep(step - 1) : () => navigate(-1)}
      />

      {/* Progress bar */}
      <div style={{ height: 4, background: colors.bgSecondary }}>
        <div style={{
          height: '100%', background: colors.gold,
          width: `${(step / TOTAL_STEPS) * 100}%`,
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
              Tell us about yourself to get started as a Ride-Along Driver
            </p>
            <Input label="First Name" value={form.firstName} onChange={update('firstName')} required />
            <Input label="Last Name" value={form.lastName} onChange={update('lastName')} required />
            <Input label="Email" value={form.email} onChange={update('email')} type="email" required />
            <Input label="Phone" value={form.phone} onChange={update('phone')} type="tel" required />
            <Input label="ZIP Code" value={form.zipCode} onChange={update('zipCode')} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
                Max Job Distance (miles)
              </div>
              <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>
                How far are you willing to travel for a job?
              </div>
              <select
                value={form.maxDistanceMiles}
                onChange={(e) => update('maxDistanceMiles')(e.target.value)}
                style={{
                  width: '100%', padding: '12px 14px', border: `1px solid ${colors.border}`,
                  borderRadius: borderRadius.sm, fontSize: 14, color: colors.textPrimary,
                  background: '#fff', appearance: 'none',
                }}
              >
                {[10, 15, 20, 25, 30, 40, 50].map(d => (
                  <option key={d} value={String(d)}>{d} miles</option>
                ))}
              </select>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
              License & Insurance
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
              A valid driver's license and active insurance are required to become a Ride-Along Driver.
            </p>
            <Input label="License Number" value={form.licenseNumber} onChange={update('licenseNumber')} required />
            <Input label="License State" value={form.licenseState} onChange={update('licenseState')} required />
            <Input label="License Expiry" value={form.licenseExpiry} onChange={update('licenseExpiry')} type="date" required />
            <FileUploadField
              label="Driver's License Photo"
              hint="Front of your license — must be clear and legible"
              state={licenseDoc}
              onSelect={(f) => handleFileSelect(f, 'license', setLicenseDoc)}
              required
            />
            <Input
              label="Insurance Expiry"
              value={form.insuranceExpiry}
              onChange={update('insuranceExpiry')}
              type="date"
              required
            />
            <FileUploadField
              label="Proof of Insurance"
              hint="Current insurance card or policy document (required)"
              state={insuranceDoc}
              onSelect={(f) => handleFileSelect(f, 'insurance', setInsuranceDoc)}
            />
          </>
        )}

        {step === 3 && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
              Profile Photo
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
              A clear headshot helps members recognize you. This is optional but recommended.
            </p>
            <FileUploadField
              label="Profile Photo"
              hint="Clear, well-lit headshot on a neutral background"
              state={profilePhoto}
              onSelect={(f) => handleFileSelect(f, 'profile_photo', setProfilePhoto)}
            />
            {!profilePhoto.path && (
              <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 8 }}>
                You can skip this step and add a photo later.
              </div>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
              Ride-Along Driver Agreement
            </h2>
            <p style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20 }}>
              Please review and acknowledge the terms before submitting.
            </p>

            {/* Summary */}
            <div style={{ background: colors.bgSecondary, borderRadius: borderRadius.md, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Application Summary</div>
              <div style={{ fontSize: 14, color: colors.textPrimary, lineHeight: 1.8 }}>
                <strong>{form.firstName} {form.lastName}</strong><br />
                {form.email} · {form.phone}<br />
                {form.zipCode && <>ZIP: {form.zipCode} · </>}Max distance: {form.maxDistanceMiles} mi<br />
                License: {form.licenseState} — {form.licenseNumber}
              </div>
            </div>

            {/* Documents status */}
            <div style={{ background: colors.bgSecondary, borderRadius: borderRadius.md, padding: 16, marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Documents</div>
              {[
                { label: "Driver's License", uploaded: !!licenseDoc.path, required: true },
                { label: 'Proof of Insurance', uploaded: !!insuranceDoc.path, required: true },
                { label: 'Profile Photo', uploaded: !!profilePhoto.path, required: false },
              ].map(({ label, uploaded, required }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 6 }}>
                  <span style={{ color: uploaded ? colors.success : required ? colors.error : colors.textMuted }}>
                    {uploaded ? '✓' : required ? '!' : '○'}
                  </span>
                  <span style={{ color: uploaded ? colors.textPrimary : required ? colors.error : colors.textMuted }}>
                    {label} {uploaded ? 'uploaded' : required ? '(required — go back to Step 2)' : '(optional)'}
                  </span>
                </div>
              ))}
            </div>

            {/* Agreement */}
            <div style={{
              padding: 16, background: `${withAlpha(colors.navy, '08')}`, borderRadius: borderRadius.md,
              border: `1px solid ${colors.border}`, marginBottom: 20,
            }}>
              <div style={{ fontSize: 13, color: colors.textPrimary, lineHeight: 1.6, marginBottom: 12 }}>
                By submitting this application I confirm that:
                <ul style={{ margin: '8px 0', paddingLeft: 18, lineHeight: 2 }}>
                  <li>I am at least 21 years old with a valid driver's license.</li>
                  <li>I consent to a background check and driving record review.</li>
                  <li>I understand I will ride as a passenger in the primary driver's vehicle or a separate vehicle depending on the job type.</li>
                  <li>I will comply with all My Car Concierge policies and applicable laws while on the job.</li>
                  <li>I acknowledge that job availability depends on matching and dispatch (Phase 2).</li>
                </ul>
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={agreementChecked}
                  onChange={(e) => { setAgreementChecked(e.target.checked); setError(''); }}
                  style={{ marginTop: 2, width: 16, height: 16, accentColor: colors.navy }}
                />
                <span style={{ fontSize: 13, color: colors.navy, fontWeight: 500 }}>
                  I have read and agree to the Ride-Along Driver Agreement
                </span>
              </label>
            </div>

            {error && (
              <div style={{
                padding: 12, background: colors.errorBg, borderRadius: borderRadius.sm,
                color: colors.error, fontSize: 13, marginBottom: 16,
              }}>
                {error}
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 24 }}>
          {step === TOTAL_STEPS && <OfflineNotice style={{ marginBottom: 12 }} />}
          <div style={{ display: 'flex', gap: 12 }}>
            {step < TOTAL_STEPS ? (
              <Button onClick={() => setStep(step + 1)} disabled={!canProceed()} fullWidth size="lg">
                Continue
              </Button>
            ) : (
              <Button onClick={handleSubmit} loading={loading} disabled={!agreementChecked} fullWidth size="lg">
                Submit Application
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
