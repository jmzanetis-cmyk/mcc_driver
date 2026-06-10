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
import { registerPushSubscription, unregisterPushSubscription } from '@/services/push/registerPush';
import { registerNativePush, unregisterNativePush } from '@/services/push/registerNativePush';
import { setSentryUser } from '@/services/telemetry/sentry';
import type { DriverRow, PartnerRow } from '@/services/supabase/types';

export function AuthProvider({ children }: React.PropsWithChildren) {
  const setSession = useAuthStore((s) => s.setSession);
  const setDriver = useAuthStore((s) => s.setDriver);
  const setLoading = useAuthStore((s) => s.setLoading);
  const clear = useAuthStore((s) => s.clear);

  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      let session: Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session'] = null;
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('getSession timeout')), 6000),
        );
        const result = await Promise.race([supabase.auth.getSession(), timeout]);
        session = result.data.session;
      } catch {
        // Network unavailable or timed out — treat as unauthenticated.
      }
      if (!mounted) return;

      setSession(session);

      if (session?.user) {
        const driver = await hydrateDriver(session.user.id);
        if (driver) {
          // Recover any in-progress ride and replay offline actions
          await recoverRideState(driver.id);
          await replayOfflineActions();
        }
        // Register this device for real native push notifications. The server
        // resolves the Supabase user to either a `driver` or `ride_along_driver`
        // record, so this runs for both audiences (ride-along users have no
        // `drivers` row but still receive Phase 3 tandem pushes).
        // - Browsers (incl. PWA): Web Push via VAPID + service worker.
        // - iOS Capacitor build: APNs via @capacitor/push-notifications.
        // Both helpers are no-ops on the wrong platform.
        void registerPushSubscription();
        void registerNativePush();
      }

      setLoading(false);
    }

    bootstrap().catch(() => { if (mounted) setLoading(false); });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!mounted) return;
        setSession(session);

        if (!session?.user) {
          await unregisterPushSubscription().catch(() => {});
          await unregisterNativePush().catch(() => {});
          setSentryUser(null);
          clear();
          return;
        }

        await hydrateDriver(session.user.id);
        // Register for native push regardless of whether a `drivers` row was
        // found — ride-along-only sessions still need to receive Phase 3 pushes.
        void registerPushSubscription();
        void registerNativePush();
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
      .eq('profile_id', userId)
      .single();

    if (error || !data) {
      setDriver(null);
      setSentryUser(null);
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
      userId: driver.profile_id,
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
      canDoRideshare: driver.can_do_rideshare ?? false,
      canDoDelivery: driver.can_do_delivery ?? false,
      totalRidesCompleted: driver.total_rides_completed,
      averageRating: driver.average_rating,
      completionRate: driver.completion_rate,
      stripeAccountId: driver.stripe_connect_account_id ?? undefined,
      backgroundCheckPassed: driver.background_check_passed ?? false,
      bgcStatus: (driver.bgc_status ?? 'not_started') as 'not_started' | 'pending' | 'passed' | 'failed',
      licenseDocumentPath: driver.license_document_path ?? undefined,
      insuranceDocumentPath: driver.insurance_document_path ?? undefined,
      registrationDocumentPath: driver.registration_document_path ?? undefined,
      documentRejectionReason: driver.document_rejection_reason ?? undefined,
    };

    setDriver(profile);
    setSentryUser(profile.id);
    logger.info('auth.driver_hydrated', { driverId: profile.id, status: profile.status });
    return profile;
  }

  return <>{children}</>;
}
