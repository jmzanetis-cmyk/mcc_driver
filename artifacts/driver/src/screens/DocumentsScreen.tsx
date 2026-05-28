// ============================================================
// MCC Driver — Documents Screen
// ============================================================

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useDocumentCompliance, type DocumentStatus, type ComplianceLevel } from '@/hooks/useDocumentCompliance';
import { supabase } from '@/services/supabase/client';
import { PageHeader, Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { formatDate } from '@/utils/formatters';

const LEVEL_META: Record<ComplianceLevel, { color: string; bg: string; label: string }> = {
  ok:       { color: colors.success,  bg: colors.successBg, label: 'Valid' },
  warning:  { color: colors.warning,  bg: colors.warningBg, label: 'Expiring Soon' },
  critical: { color: colors.error,    bg: colors.errorBg,   label: 'Expires Very Soon' },
  expired:  { color: colors.error,    bg: colors.errorBg,   label: 'Expired' },
};

export function DocumentsScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const compliance = useDocumentCompliance();
  const [uploading, setUploading] = useState<string | null>(null);

  const handleUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    bucket: string,
    field: string,
  ) => {
    const file = e.target.files?.[0];
    if (!file || !driver) return;
    setUploading(field);
    try {
      const ext = file.name.split('.').pop() ?? 'pdf';
      const path = `${driver.id}/${field}.${ext}`;
      const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
      // Store the relative storage path, not a public URL (the bucket is private).
      if (!error) {
        await supabase.from('drivers').update({ [field]: path }).eq('id', driver.id);
      }
    } finally {
      setUploading(null);
    }
  };

  if (compliance.isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
        <PageHeader title="Documents" onBack={() => navigate('/settings')} />
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>
      </div>
    );
  }

  const docs: Array<{ status: DocumentStatus; uploadField: string; uploadLabel: string }> = [
    {
      status: compliance.license,
      uploadField: 'license_document_path',
      uploadLabel: "Upload License",
    },
    {
      status: compliance.insurance,
      uploadField: 'insurance_document_path',
      uploadLabel: "Upload Insurance",
    },
    {
      status: compliance.registration,
      uploadField: 'registration_document_path',
      uploadLabel: "Upload Registration",
    },
  ];

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Documents" onBack={() => navigate('/settings')} />

      <div style={{ padding: 20 }}>
        {compliance.isBlocked && (
          <div style={{
            padding: '12px 14px', borderRadius: borderRadius.md,
            background: colors.errorBg, border: `1px solid ${colors.error}`,
            marginBottom: 16, fontSize: 13, color: colors.error, fontWeight: 600,
          }}>
            🚫 One or more documents are expired. You cannot go online until they are renewed.
          </div>
        )}

        {/* Background check */}
        <Card padding={16} style={{ marginBottom: 12 }}>
          <DocumentRow
            status={compliance.backgroundCheck}
            uploading={null}
            uploadField=""
            uploadLabel=""
            onUpload={() => {}}
            hideUpload
          />
        </Card>

        {docs.map(({ status, uploadField, uploadLabel }) => (
          <Card key={uploadField} padding={16} style={{ marginBottom: 12 }}>
            <DocumentRow
              status={status}
              uploading={uploading}
              uploadField={uploadField}
              uploadLabel={uploadLabel}
              onUpload={(e) => void handleUpload(e, 'driver-documents', uploadField)}
            />
          </Card>
        ))}

        <Card padding={14}>
          <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.5 }}>
            <strong>Document guidelines:</strong> Upload clear photos or PDFs. Your documents are stored securely and only accessed by My Car Concierge admins for compliance review.
          </div>
        </Card>
      </div>
    </div>
  );
}

function DocumentRow({
  status, uploading, uploadField, uploadLabel, onUpload, hideUpload = false,
}: {
  status: DocumentStatus;
  uploading: string | null;
  uploadField: string;
  uploadLabel: string;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  hideUpload?: boolean;
}) {
  const meta = LEVEL_META[status.level];
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>{status.label}</div>
        <span style={{
          fontSize: 11, fontWeight: 700, color: meta.color,
          background: meta.bg, padding: '2px 8px',
          borderRadius: borderRadius.full, textTransform: 'uppercase',
        }}>
          {meta.label}
        </span>
      </div>
      {status.expiresAt && (
        <div style={{ fontSize: 12, color: colors.textMuted, marginBottom: 8 }}>
          {status.level === 'expired' ? 'Expired' : 'Expires'}: {formatDate(status.expiresAt)}
          {status.daysLeft !== null && status.daysLeft >= 0 && (
            <span style={{ color: meta.color, fontWeight: 600 }}> ({status.daysLeft} day{status.daysLeft !== 1 ? 's' : ''} left)</span>
          )}
        </div>
      )}
      {!hideUpload && (
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 14px', background: colors.bgSecondary,
          borderRadius: borderRadius.sm, cursor: 'pointer',
          fontSize: 12, fontWeight: 600, color: colors.navy,
        }}>
          {uploading === uploadField ? 'Uploading…' : `📎 ${uploadLabel}`}
          <input
            type="file"
            accept="image/*,application/pdf"
            style={{ display: 'none' }}
            onChange={onUpload}
            disabled={uploading === uploadField}
          />
        </label>
      )}
    </div>
  );
}
