// ============================================================
// MCC Driver — Provider Tandem Match Card
// ============================================================
// Shown to the primary (provider) driver once a ride-along
// match has been found via Mode B platform matching. Shows the
// matched driver's photo, name, rating, and MCC Verified badge,
// with a Request Rematch action. Provider does not need to
// "accept" — the matched driver has already accepted on their
// side; the only remaining gate is member approval.
// ============================================================

import React, { useState } from 'react';
import { Button, Card } from '@/components';
import { colors, borderRadius } from '@/theme';
import { requestTandemRematch, providerAcceptTandemMatch } from '@/services/api/edgeFunctions';

export interface MatchedDriverInfo {
  firstName: string;
  lastName: string;
  rating: number;
  totalJobs: number;
  profilePhotoPath: string | null;
}

export interface TandemMatchCardProps {
  tandemJobId: string;
  matchedDriver: MatchedDriverInfo | null;
  matchStatus: string;
  memberApproved: boolean | null;
  onAccept?: () => void;
  onRematch?: () => void;
}

function MatchedDriverPhoto({ driver }: { driver: MatchedDriverInfo }) {
  if (driver.profilePhotoPath) {
    return (
      <img
        src={driver.profilePhotoPath}
        alt={`${driver.firstName} ${driver.lastName}`}
        style={{
          width: 56, height: 56, borderRadius: '50%',
          objectFit: 'cover', flexShrink: 0,
          background: colors.bgSecondary,
        }}
      />
    );
  }
  return (
    <div style={{
      width: 56, height: 56, borderRadius: '50%',
      background: colors.bgSecondary, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      fontSize: 18, fontWeight: 700, color: colors.navy,
      flexShrink: 0,
    }}>
      {driver.firstName[0]}{driver.lastName[0]}
    </div>
  );
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

  const handleAccept = async () => {
    setActing('accept');
    setError('');
    const res = await providerAcceptTandemMatch(tandemJobId);
    setActing(null);
    if (res.success) {
      onAccept?.();
    } else {
      setError(res.error ?? 'Failed to accept match.');
    }
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <MatchedDriverPhoto driver={matchedDriver} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: colors.navy }}>
              {matchedDriver.firstName} {matchedDriver.lastName.charAt(0)}.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{
                fontSize: 9, fontWeight: 700, color: colors.navy,
                background: colors.gold, padding: '2px 6px',
                borderRadius: borderRadius.full, letterSpacing: 0.5,
              }}>
                MCC VERIFIED
              </span>
              <span style={{ fontSize: 12, color: colors.textMuted }}>
                ⭐ {Number(matchedDriver.rating ?? 0).toFixed(1)} · {matchedDriver.totalJobs ?? 0} jobs
              </span>
            </div>
          </div>
          <div style={{
            fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 999,
            background: `${statusColor}20`, color: statusColor, whiteSpace: 'nowrap',
          }}>
            {statusLabel.toUpperCase()}
          </div>
        </div>
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
          {matchStatus === 'matched' && (
            <Button
              onClick={() => void handleAccept()}
              loading={acting === 'accept'}
              disabled={acting !== null}
              size="sm"
              fullWidth
            >
              Accept Match
            </Button>
          )}
          <Button
            onClick={() => void handleRematch()}
            loading={acting === 'rematch'}
            disabled={acting !== null}
            variant="ghost"
            size="sm"
            fullWidth={matchStatus !== 'matched'}
          >
            Request Rematch
          </Button>
        </div>
      )}
    </Card>
  );
}
