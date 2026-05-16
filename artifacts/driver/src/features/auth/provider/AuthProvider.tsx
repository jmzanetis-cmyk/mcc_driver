// ============================================================
// MCC Driver — Auth Provider
// ============================================================
// Initializes auth state, listens for changes, hydrates driver.
// ============================================================

import { useEffect } from 'react';
import { supabase } from '@/services/supabase/client';
import { useAuthStore, type DriverProfile } from '@/store/authStore';
import { logger } from '@/services/telemetry/logger';
import { recoverRideState, replayOfflineActions } from '@/services/offline/recovery';
import type { DriverRow, PartnerRow } from '@/services/supabase/types';

export function AuthProvider({ children }: React.PropsWithChildren) {
  const setSession = useAuthStore((s) => s.setSession);
  const setDriver = useAuthStore((s) => s.setDriver);
  const setLoading = useAuthStore((s) => s.setLoading);
  const clear = useAuthStore((s) => s.clear);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;

      setSession(session);

      if (session?.user) {
        const driver = await hydrateDriver(session.user.id);
        if (driver) {
          // Recover any in-progress ride and replay offline actions
          await recoverRideState(driver.id);
          await replayOfflineActions();
        }
      }

      setLoading(false);
    }

    bootstrap();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!mounted) return;
        setSession(session);

        if (!session?.user) {
          clear();
          return;
        }

        await hydrateDriver(session.user.id);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function hydrateDriver(userId: string): Promise<DriverProfile | null> {
    const { data, error } = await supabase
      .from('drivers')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      setDriver(null);
      return null;
    }

    const driver = data as unknown as DriverRow;

    // Get partner name if applicable
    let partnerName: string | undefined;
    if (driver.partner_id) {
      const { data: partnerData } = await supabase
        .from('transportation_partners')
        .select('company_name')
        .eq('id', driver.partner_id)
        .single();
      const partner = partnerData as unknown as PartnerRow | null;
      partnerName = partner?.company_name;
    }

    const profile: DriverProfile = {
      id: driver.id,
      userId: driver.user_id,
      firstName: driver.first_name,
      lastName: driver.last_name,
      email: driver.email,
      phone: driver.phone,
      status: driver.status,
      profilePhotoUrl: driver.profile_photo_url ?? undefined,
      partnerId: driver.partner_id ?? undefined,
      partnerName,
      isOnline: driver.is_online,
      canDriveMemberVehicle: driver.can_drive_member_vehicle,
      totalRidesCompleted: driver.total_rides_completed,
      averageRating: driver.average_rating,
      completionRate: driver.completion_rate,
      stripeAccountId: driver.stripe_account_id ?? undefined,
      backgroundCheckPassed: driver.background_check_passed ?? false,
      licenseDocumentPath: driver.license_document_path ?? undefined,
      insuranceDocumentPath: driver.insurance_document_path ?? undefined,
      documentRejectionReason: driver.document_rejection_reason ?? undefined,
    };

    setDriver(profile);
    logger.info('auth.driver_hydrated', { driverId: profile.id, status: profile.status });
    return profile;
  }

  return <>{children}</>;
}
