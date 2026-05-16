// ============================================================
// MCC Driver — Update Documents Modal
// ============================================================
// Allows drivers with pending_approval status to re-upload their
// license photo and/or insurance document.
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { colors, borderRadius, shadows, withAlpha } from '@/theme';
import { Button, Spinner } from '@/components';
import { uploadDriverDocument } from '@/services/documents/documentService';
import { updateDriverDocuments } from '@/services/auth/authService';
import { useAuth } from '@/hooks/useAuth';

interface UpdateDocumentsModalProps {
  onClose: () => void;
  rejectionReason?: string;
}

type UploadState = 'idle' | 'uploading' | 'done' | 'error';

interface FileState {
  file: File | null;
  state: UploadState;
  path?: string;
  error?: string;
}

function FileUploadRow({
  label,
  hint,
  icon,
  existing,
  fileState,
  inputRef,
  onChange,
}: {
  label: string;
  hint: string;
  icon: string;
  existing: boolean;
  fileState: FileState;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (file: File) => void;
}) {
  const handleClick = () => inputRef.current?.click();

  // Create / revoke an object URL for image previews
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (fileState.file?.type.startsWith('image/')) {
      const url = URL.createObjectURL(fileState.file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
    return undefined;
  }, [fileState.file]);

  const isPdf = fileState.file?.type === 'application/pdf';
  const hasNewFile = fileState.file !== null;

  const statusColor =
    fileState.state === 'done'
      ? colors.success
      : fileState.state === 'error'
        ? colors.error
        : existing
          ? colors.success
          : colors.textMuted;

  const statusLabel =
    fileState.state === 'done'
      ? 'Uploaded successfully'
      : fileState.state === 'error'
        ? fileState.error ?? 'Upload failed'
        : fileState.state === 'uploading'
          ? 'Uploading…'
          : hasNewFile
            ? 'Ready to upload — tap Replace to change'
            : existing
              ? 'On file — tap to replace'
              : 'Not uploaded — tap to add';

  return (
    <div style={{
      background: colors.bgSecondary,
      borderRadius: borderRadius.md,
      border: `1px solid ${hasNewFile ? colors.gold + '80' : colors.border}`,
      padding: '14px 16px',
      marginBottom: 12,
      transition: 'border-color 0.2s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>

        {/* Icon / thumbnail area */}
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Preview"
            style={{
              width: 48, height: 48, borderRadius: borderRadius.md,
              objectFit: 'cover', flexShrink: 0,
              border: `1px solid ${colors.border}`,
            }}
          />
        ) : (
          <div style={{
            width: 48, height: 48, borderRadius: borderRadius.md,
            background: isPdf ? colors.warningBg : colors.bgCard,
            border: `1px solid ${isPdf ? colors.warning : colors.border}`,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            fontSize: isPdf ? 18 : 20, flexShrink: 0,
            gap: 1,
          }}>
            {isPdf ? (
              <>
                <span>📄</span>
                <span style={{ fontSize: 8, fontWeight: 700, color: colors.warning, letterSpacing: '0.05em' }}>PDF</span>
              </>
            ) : icon}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary, marginBottom: 2 }}>
            {label}
          </div>

          {/* Filename shown when a new file is staged */}
          {hasNewFile && fileState.state !== 'done' && fileState.state !== 'uploading' && (
            <div style={{
              fontSize: 12, color: colors.navy, fontWeight: 500,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              marginBottom: 2,
            }}>
              {fileState.file!.name}
            </div>
          )}

          <div style={{ fontSize: 12, color: statusColor, display: 'flex', alignItems: 'center', gap: 4 }}>
            {fileState.state === 'uploading' && <Spinner size={10} color={colors.gold} />}
            {fileState.state === 'done' && '✓ '}
            {fileState.state === 'error' && '✗ '}
            {fileState.state === 'idle' && existing && !hasNewFile && '✓ '}
            {fileState.state === 'idle' && hasNewFile && '● '}
            {statusLabel}
          </div>

          {!hasNewFile && (
            <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{hint}</div>
          )}
        </div>

        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="file"
          accept="image/*,application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onChange(f);
          }}
        />

        <button
          onClick={handleClick}
          disabled={fileState.state === 'uploading'}
          style={{
            flexShrink: 0,
            padding: '8px 14px',
            borderRadius: borderRadius.sm,
            border: `1px solid ${colors.border}`,
            background: colors.bgCard,
            color: colors.textSecondary,
            fontSize: 12, fontWeight: 600,
            cursor: fileState.state === 'uploading' ? 'wait' : 'pointer',
            opacity: fileState.state === 'uploading' ? 0.5 : 1,
          }}
        >
          {existing || hasNewFile ? 'Replace' : 'Upload'}
        </button>
      </div>
    </div>
  );
}

export function UpdateDocumentsModal({ onClose, rejectionReason }: UpdateDocumentsModalProps) {
  const { driver, refreshDriver } = useAuth();

  const licenseRef = useRef<HTMLInputElement | null>(null);
  const insuranceRef = useRef<HTMLInputElement | null>(null);

  const [license, setLicense] = useState<FileState>({ file: null, state: 'idle' });
  const [insurance, setInsurance] = useState<FileState>({ file: null, state: 'idle' });

  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleFileSelect = (
    file: File,
    setState: React.Dispatch<React.SetStateAction<FileState>>,
  ) => {
    setState({ file, state: 'idle' });
  };

  const canSubmit =
    (license.file !== null || insurance.file !== null) &&
    license.state !== 'uploading' &&
    insurance.state !== 'uploading';

  const handleSubmit = async () => {
    if (!driver || !canSubmit) return;

    setSubmitting(true);
    setSubmitResult(null);

    let licensePath: string | undefined;
    let insurancePath: string | undefined;
    let hasError = false;

    if (license.file) {
      setLicense((s) => ({ ...s, state: 'uploading' }));
      const result = await uploadDriverDocument(driver.userId, 'license', license.file);
      if (result.success && result.path) {
        licensePath = result.path;
        setLicense((s) => ({ ...s, state: 'done', path: result.path }));
      } else {
        setLicense((s) => ({ ...s, state: 'error', error: result.error ?? 'Upload failed' }));
        hasError = true;
      }
    }

    if (insurance.file) {
      setInsurance((s) => ({ ...s, state: 'uploading' }));
      const result = await uploadDriverDocument(driver.userId, 'insurance', insurance.file);
      if (result.success && result.path) {
        insurancePath = result.path;
        setInsurance((s) => ({ ...s, state: 'done', path: result.path }));
      } else {
        setInsurance((s) => ({ ...s, state: 'error', error: result.error ?? 'Upload failed' }));
        hasError = true;
      }
    }

    if (licensePath || insurancePath) {
      const updateResult = await updateDriverDocuments({ licenseDocumentPath: licensePath, insuranceDocumentPath: insurancePath });
      if (updateResult.success) {
        await refreshDriver();
        if (hasError) {
          setSubmitResult({ success: true, message: 'Some documents were saved, but one upload failed. Please retry the failed document.' });
        } else {
          setSubmitResult({ success: true, message: 'Documents updated successfully. Our team will review them shortly.' });
        }
      } else {
        setSubmitResult({ success: false, message: updateResult.error ?? 'Failed to save documents. Please try again.' });
      }
    } else if (hasError) {
      setSubmitResult({ success: false, message: 'Documents failed to upload. Please check your files and try again.' });
    }

    setSubmitting(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: colors.bgOverlay,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: colors.bgCard,
        borderRadius: `${borderRadius.lg}px ${borderRadius.lg}px 0 0`,
        width: '100%', maxWidth: 480,
        padding: '0 0 32px',
        boxShadow: shadows.lg,
        maxHeight: '90vh',
        overflowY: 'auto',
      }}>
        {/* Handle bar */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: colors.border }} />
        </div>

        {/* Header */}
        <div style={{ padding: '12px 20px 16px', borderBottom: `1px solid ${colors.borderLight}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span className="eyebrow" style={{ marginBottom: 2 }}>
                {rejectionReason ? 'Action Required' : 'Documents'}
              </span>
              <h2 className="heading-editorial heading-editorial-md">
                {rejectionReason ? 'Re-upload Documents' : 'Update Documents'}
              </h2>
              <p style={{ fontSize: 13, color: colors.textMuted, margin: '4px 0 0' }}>
                {rejectionReason
                  ? 'Your documents were flagged by a My Car Concierge reviewer. Please re-upload them below.'
                  : 'Re-upload any documents that need to be replaced.'}
              </p>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: 'none', fontSize: 20,
                color: colors.textMuted, cursor: 'pointer', padding: 4,
              }}
            >
              ✕
            </button>
          </div>

          {/* Rejection reason banner inside modal */}
          {rejectionReason && (
            <div style={{
              marginTop: 12, padding: '10px 14px',
              background: colors.errorBg,
              border: `1px solid ${withAlpha(colors.error, '40')}`,
              borderRadius: borderRadius.md,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.error, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Reviewer note
              </div>
              <div style={{ fontSize: 13, color: colors.textPrimary, lineHeight: 1.5 }}>
                {rejectionReason}
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ padding: '20px 20px 0' }}>
          {submitResult ? (
            <div style={{
              padding: 16, borderRadius: borderRadius.md,
              background: submitResult.success ? `${withAlpha(colors.success, '15')}` : colors.errorBg,
              border: `1px solid ${submitResult.success ? `${withAlpha(colors.success, '40')}` : `${withAlpha(colors.error, '40')}`}`,
              marginBottom: 20,
            }}>
              <div style={{
                fontSize: 14, fontWeight: 600,
                color: submitResult.success ? colors.success : colors.error,
                marginBottom: 4,
              }}>
                {submitResult.success ? '✓ Documents Updated' : '✗ Update Failed'}
              </div>
              <div style={{ fontSize: 13, color: colors.textSecondary }}>
                {submitResult.message}
              </div>
            </div>
          ) : null}

          <FileUploadRow
            label="Driver's License Photo"
            hint="JPG, PNG or PDF — must be clear and legible"
            icon="🪪"
            existing={!!driver?.licenseDocumentPath}
            fileState={license}
            inputRef={licenseRef}
            onChange={(f) => handleFileSelect(f, setLicense)}
          />

          <FileUploadRow
            label="Proof of Insurance"
            hint="JPG, PNG or PDF — must show policy & expiry date"
            icon="📄"
            existing={!!driver?.insuranceDocumentPath}
            fileState={insurance}
            inputRef={insuranceRef}
            onChange={(f) => handleFileSelect(f, setInsurance)}
          />

          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {submitResult?.success ? (
              <Button onClick={onClose} variant="primary" size="md" fullWidth>
                Done
              </Button>
            ) : (
              <>
                <Button
                  onClick={handleSubmit}
                  variant="primary"
                  size="md"
                  fullWidth
                  loading={submitting}
                  disabled={!canSubmit || submitting}
                >
                  Submit Documents
                </Button>
                <Button onClick={onClose} variant="ghost" size="md" fullWidth>
                  Cancel
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
