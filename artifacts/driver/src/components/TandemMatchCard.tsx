// ============================================================
// MCC Driver — Provider Tandem Match Card
// ============================================================
// Shown to the primary (provider) driver once a ride-along
// match has been found via Mode B platform matching.
// Provides Accept (continue as-is, awaiting member approval)
// or Request Rematch (re-broadcast to other drivers).
// ============================================================

import React, { useState } from 'react';
import { Button, Card } from '@/components';
import { colors, borderRadius } from '@/theme';
import { requestTandemRematch } from '@/services/api/edgeFunctions';

export interface TandemMatchCardProps {
  tandemJobId: string;
  matchedDriver: {
    firstName: string;
    lastName: string;
    rating: number;
    totalJobs: number;
  } | null;
  matchStatus: string;
  memberApproved: boolean | null;
  onAccept?: () => void;
  onRematch?: () => void;
}

export function TandemMatchCard({
  tandemJobId,
  matchedDriver,
  matchStatus,
  memberApproved,
  onAccept,
  onRematch,
}: TandemMatchCardProps) {
  const [acting, setActing] = useState<'accept' | 'rematch' | null>(null);
  const [error, setError] = useState('');

  const handleAccept = () => {
    setError('');
    onAccept?.();
  };

  const handleRematch = async () => {
    setActing('rematch');
    setError('');
    const res = await requestTandemRematch(tandemJobId);
    setActing(null);
    if (res.success) {
      onRematch?.();
    } else {
      setError(res.error ?? 'Failed to request rematch.');
    }
  };

  const statusLabel =
    matchStatus === 'confirmed'
      ? 'Member Approved'
      : memberApproved === false
        ? 'Member Declined'
        : 'Awaiting Member Approval';

  const statusColor =
    matchStatus === 'confirmed'
      ? colors.success
      : memberApproved === false
        ? colors.error
        : colors.warning;

  return (
    <Card padding={16} style={{ border: `1px solid ${colors.gold}` }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: colors.gold, letterSpacing: 0.5, marginBottom: 8 }}>
        RIDE-ALONG DRIVER MATCHED
      </div>

      {matchedDriver ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{
              width: 48, height: 48, borderRadius: '50%',
              background: colors.bgSecondary, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700, color: colors.navy,
            }}>
              {matchedDriver.firstName[0]}{matchedDriver.lastName[0]}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: colors.navy }}>
                {matchedDriver.firstName} {matchedDriver.lastName.charAt(0)}.
              </div>
              <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                ⭐ {Number(matchedDriver.rating ?? 0).toFixed(1)} · {matchedDriver.totalJobs ?? 0} jobs
              </div>
            </div>
            <div style={{
              fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 999,
              background: `${statusColor}20`, color: statusColor, whiteSpace: 'nowrap',
            }}>
              {statusLabel.toUpperCase()}
            </div>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 12 }}>
          Waiting for a ride-along driver to accept…
        </div>
      )}

      {error && (
        <div style={{
          padding: 10, marginBottom: 12, borderRadius: borderRadius.md,
          background: colors.errorBg, color: colors.error, fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {matchStatus !== 'confirmed' && matchedDriver && (
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            onClick={handleAccept}
            disabled={acting !== null}
            size="sm"
            fullWidth
          >
            Accept Match
          </Button>
          <Button
            onClick={() => void handleRematch()}
            loading={acting === 'rematch'}
            disabled={acting !== null}
            variant="ghost"
            size="sm"
          >
            Request Rematch
          </Button>
        </div>
      )}
    </Card>
  );
}
