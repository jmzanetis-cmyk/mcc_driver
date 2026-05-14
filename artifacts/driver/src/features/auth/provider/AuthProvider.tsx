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
      .single() as any;

    if (error || !data) {
      setDriver(null);
      return null;
    }

    // Get partner name if applicable
    let partnerName: string | undefined;
    if (data.partner_id) {
      const { data: partner } = await supabase
        .from('transportation_partners')
        .select('company_name')
        .eq('id', data.partner_id)
        .single() as any;
      partnerName = partner?.company_name;
    }

    const profile: DriverProfile = {
      id: data.id,
      userId: data.user_id,
      firstName: data.first_name,
      lastName: data.last_name,
      email: data.email,
      phone: data.phone,
      status: data.status,
      profilePhotoUrl: data.profile_photo_url ?? undefined,
      partnerId: data.partner_id ?? undefined,
      partnerName,
      isOnline: data.is_online,
      canDriveMemberVehicle: data.can_drive_member_vehicle,
      totalRidesCompleted: data.total_rides_completed,
      averageRating: data.average_rating,
      completionRate: data.completion_rate,
      stripeAccountId: data.stripe_account_id ?? undefined,
    };

    setDriver(profile);
    logger.info('auth.driver_hydrated', { driverId: profile.id, status: profile.status });
    return profile;
  }

  return <>{children}</>;
}
