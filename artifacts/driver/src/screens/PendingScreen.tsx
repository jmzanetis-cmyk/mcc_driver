// ============================================================
// MCC Driver — Approval Pending Screen
// ============================================================

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { colors, borderRadius } from '@/theme';
import { Button } from '@/components';
import { UpdateDocumentsModal } from './UpdateDocumentsModal';

type StepStatus = 'done' | 'pending' | 'waiting';

interface Step {
  label: string;
  status: StepStatus;
}

function buildSteps(
  driverStatus: string | undefined,
  backgroundCheckPassed: boolean,
): Step[] {
  const isActive = driverStatus === 'active';

  return [
    {
      label: 'Application submitted',
      status: 'done',
    },
    {
      label: 'Background check',
      status: backgroundCheckPassed ? 'done' : isActive ? 'done' : 'pending',
    },
    {
      label: 'Driving record review',
      status: backgroundCheckPassed ? 'done' : isActive ? 'done' : 'pending',
    },
    {
      label: 'Account activation',
      status: isActive ? 'done' : 'waiting',
    },
  ];
}

export function PendingScreen() {
  const { refreshDriver, signOut, driver } = useAuth();
  const [showUpdateDocs, setShowUpdateDocs] = useState(false);

  const hasRejection = !!driver?.documentRejectionReason;

  // Auto-open the modal when the driver has a rejection reason
  useEffect(() => {
    if (hasRejection) {
      setShowUpdateDocs(true);
    }
  }, [hasRejection]);

  const steps = buildSteps(driver?.status, driver?.backgroundCheckPassed ?? false);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'center', padding: 32,
      background: colors.bgPrimary,
    }}>
      {/* Document rejection notice — shown prominently when admin has flagged docs */}
      {hasRejection && (
        <div style={{
          width: '100%', maxWidth: 360, marginBottom: 20,
          background: colors.errorBg,
          border: `2px solid ${colors.error}`,
          borderRadius: borderRadius.lg,
          padding: '16px 18px',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ fontSize: 20, flexShrink: 0, marginTop: 1 }}>⚠️</div>
            <div>
              <div style={{
                fontSize: 14, fontWeight: 700, color: colors.error,
                marginBottom: 6,
              }}>
                Action Required — Documents Rejected
              </div>
              <div style={{
                fontSize: 13, color: colors.textPrimary, lineHeight: 1.5,
              }}>
                {driver?.documentRejectionReason}
              </div>
              <div style={{
                fontSize: 12, color: colors.textMuted, marginTop: 8,
              }}>
                Please re-upload the required documents below. Your application will be re-reviewed once new documents are received.
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{
        width: 64, height: 64, borderRadius: '50%',
        background: hasRejection ? colors.errorBg : colors.warningBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28, marginBottom: 20,
        border: hasRejection ? `2px solid ${colors.error}40` : 'none',
      }}>
        {hasRejection ? '📋' : '⏳'}
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.navy, marginBottom: 8, textAlign: 'center' }}>
        {hasRejection ? 'Documents Need Updating' : 'Application Under Review'}
      </h1>
      <p style={{ fontSize: 14, color: colors.textMuted, textAlign: 'center', maxWidth: 320, marginBottom: 32 }}>
        {hasRejection
          ? 'An MCC reviewer has flagged your documents. Please re-upload them to continue your application.'
          : "We're reviewing your application. You'll receive a push notification when you're approved to start driving."}
      </p>

      {/* Status checklist */}
      <div style={{
        background: colors.bgCard, borderRadius: borderRadius.lg,
        border: `1px solid ${hasRejection ? `${colors.error}40` : colors.border}`,
        padding: 20,
        width: '100%', maxWidth: 360,
      }}>
        {steps.map((step, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 0',
            borderBottom: i < steps.length - 1 ? `1px solid ${colors.borderLight}` : 'none',
          }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700,
              background: step.status === 'done' ? colors.success : step.status === 'pending' ? colors.warningBg : colors.bgSecondary,
              color: step.status === 'done' ? '#fff' : step.status === 'pending' ? colors.warning : colors.textMuted,
            }}>
              {step.status === 'done' ? '✓' : step.status === 'pending' ? '•' : '○'}
            </div>
            <span style={{
              fontSize: 14,
              color: step.status === 'done' ? colors.success : step.status === 'pending' ? colors.textPrimary : colors.textMuted,
              fontWeight: step.status === 'pending' ? 500 : 400,
            }}>
              {step.label}
            </span>
            {step.status === 'pending' && (
              <span style={{
                marginLeft: 'auto', fontSize: 11, fontWeight: 600,
                color: colors.warning, background: colors.warningBg,
                padding: '2px 8px', borderRadius: 4,
              }}>
                IN PROGRESS
              </span>
            )}
            {step.status === 'done' && i > 0 && (
              <span style={{
                marginLeft: 'auto', fontSize: 11, fontWeight: 600,
                color: colors.success, background: `${colors.success}20`,
                padding: '2px 8px', borderRadius: 4,
              }}>
                COMPLETE
              </span>
            )}
          </div>
        ))}
      </div>

      {driver?.licenseDocumentPath || driver?.insuranceDocumentPath ? (
        <div style={{
          marginTop: 16, padding: 12,
          background: hasRejection ? colors.errorBg : `${colors.success}15`,
          borderRadius: borderRadius.md,
          border: `1px solid ${hasRejection ? `${colors.error}30` : `${colors.success}30`}`,
          width: '100%', maxWidth: 360,
        }}>
          <div style={{
            fontSize: 12, fontWeight: 600,
            color: hasRejection ? colors.error : colors.success,
            marginBottom: 6,
          }}>
            {hasRejection ? '⚠️ Documents Flagged for Resubmission' : 'Documents Received'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {driver.licenseDocumentPath && (
              <div style={{ fontSize: 12, color: colors.textMuted }}>
                {hasRejection ? '⚠️' : '✓'} Driver's license photo
              </div>
            )}
            {driver.insuranceDocumentPath && (
              <div style={{ fontSize: 12, color: colors.textMuted }}>
                {hasRejection ? '⚠️' : '✓'} Proof of insurance
              </div>
            )}
          </div>
        </div>
      ) : null}

      {driver?.status === 'pending_approval' && (
        <div style={{ marginTop: 20, width: '100%', maxWidth: 360 }}>
          {hasRejection ? (
            <Button
              onClick={() => setShowUpdateDocs(true)}
              variant="primary"
              size="md"
              fullWidth
              style={{
                background: colors.error,
                borderColor: colors.error,
                fontWeight: 700,
                fontSize: 15,
              }}
            >
              📎 Re-upload Documents Now
            </Button>
          ) : (
            <Button
              onClick={() => setShowUpdateDocs(true)}
              variant="secondary"
              size="md"
              fullWidth
            >
              📎 Update Documents
            </Button>
          )}
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
        <Button onClick={refreshDriver} variant="secondary" size="sm">
          Check Status
        </Button>
        <Button onClick={signOut} variant="ghost" size="sm">
          Sign Out
        </Button>
      </div>

      {showUpdateDocs && (
        <UpdateDocumentsModal
          onClose={() => setShowUpdateDocs(false)}
          rejectionReason={driver?.documentRejectionReason}
        />
      )}
    </div>
  );
}
