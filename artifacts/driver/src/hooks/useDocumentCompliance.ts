// ============================================================
// MCC Driver — useDocumentCompliance
// ============================================================
// Checks expiry dates for license, insurance, and vehicle
// registration. Returns warning levels and online-block status.
// ============================================================

import { useState, useEffect } from 'react';
import { supabase } from '@/services/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export type ComplianceLevel = 'ok' | 'warning' | 'critical' | 'expired';

export interface DocumentStatus {
  label: string;
  expiresAt: string | null;
  level: ComplianceLevel;
  daysLeft: number | null;
}

export interface ComplianceState {
  license: DocumentStatus;
  insurance: DocumentStatus;
  registration: DocumentStatus;
  backgroundCheck: DocumentStatus;
  isBlocked: boolean;
  hasWarnings: boolean;
  isLoading: boolean;
}

function computeLevel(expiresAt: string | null): { level: ComplianceLevel; daysLeft: number | null } {
  if (!expiresAt) return { level: 'ok', daysLeft: null };
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
  if (days < 0) return { level: 'expired', daysLeft: days };
  if (days <= 7) return { level: 'critical', daysLeft: days };
  if (days <= 30) return { level: 'warning', daysLeft: days };
  return { level: 'ok', daysLeft: days };
}

const EMPTY: DocumentStatus = { label: '', expiresAt: null, level: 'ok', daysLeft: null };

export function useDocumentCompliance(): ComplianceState {
  const { driver } = useAuth();
  const [state, setState] = useState<ComplianceState>({
    license: EMPTY,
    insurance: EMPTY,
    registration: EMPTY,
    backgroundCheck: EMPTY,
    isBlocked: false,
    hasWarnings: false,
    isLoading: true,
  });

  useEffect(() => {
    if (!driver) return;
    void (async () => {
      // Fetch expiry fields from drivers + vehicles
      const [driverRes, vehicleRes] = await Promise.all([
        supabase.from('drivers')
          .select('license_expiry, insurance_expiry, background_check_passed')
          .eq('id', driver.id)
          .single(),
        supabase.from('vehicles')
          .select('insurance_expiry, registration_expiry')
          .eq('driver_id', driver.id)
          .eq('is_active', true)
          .maybeSingle(),
      ]);

      const d = driverRes.data as {
        license_expiry: string | null;
        insurance_expiry: string | null;
        background_check_passed: boolean;
      } | null;
      const v = vehicleRes.data as {
        insurance_expiry: string | null;
        registration_expiry: string | null;
      } | null;

      const licenseLevel = computeLevel(d?.license_expiry ?? null);
      const insuranceLevel = computeLevel(d?.insurance_expiry ?? null);
      const registrationLevel = computeLevel(v?.registration_expiry ?? null);

      const bgLevel: ComplianceLevel = (d?.background_check_passed ?? driver.backgroundCheckPassed)
        ? 'ok' : 'expired';

      const docs = [licenseLevel.level, insuranceLevel.level, registrationLevel.level, bgLevel];
      const isBlocked = docs.some((l) => l === 'expired');
      const hasWarnings = docs.some((l) => l === 'warning' || l === 'critical');

      setState({
        license: { label: "Driver's License", expiresAt: d?.license_expiry ?? null, ...licenseLevel },
        insurance: { label: 'Personal Insurance', expiresAt: d?.insurance_expiry ?? null, ...insuranceLevel },
        registration: { label: 'Vehicle Registration', expiresAt: v?.registration_expiry ?? null, ...registrationLevel },
        backgroundCheck: { label: 'Background Check', expiresAt: null, level: bgLevel, daysLeft: null },
        isBlocked,
        hasWarnings,
        isLoading: false,
      });
    })();
  }, [driver?.id]);

  return state;
}
