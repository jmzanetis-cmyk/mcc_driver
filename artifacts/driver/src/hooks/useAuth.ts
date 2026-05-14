// ============================================================
// MCC Driver — useAuth Hook (Zustand wrapper)
// ============================================================
// Thin wrapper around useAuthStore that provides the same API
// the screens expect: { driver, signOut, refreshDriver, ... }
// ============================================================

import { useCallback } from 'react';
import { useAuthStore, type DriverProfile } from '@/store/authStore';
import { supabase } from '@/services/supabase/client';

export { type DriverProfile } from '@/store/authStore';

export function useAuth() {
  const session = useAuthStore((s) => s.session);
  const user = useAuthStore((s) => s.user);
  const driver = useAuthStore((s) => s.driver);
  const loading = useAuthStore((s) => s.loading);
  const setDriver = useAuthStore((s) => s.setDriver);
  const clear = useAuthStore((s) => s.clear);

  const signOut = useCallback(async () => {
    if (driver) {
      await supabase.from('drivers').update({ is_online: false }).eq('id', driver.id);
    }
    await supabase.auth.signOut();
    clear();
  }, [driver, clear]);

  const refreshDriver = useCallback(async () => {
    if (!user) return;

    const { data } = await supabase
      .from('drivers')
      .select('*')
      .eq('user_id', user.id)
      .single() as any;

    if (data) {
      let partnerName: string | undefined;
      if (data.partner_id) {
        const { data: partner } = await supabase
          .from('transportation_partners')
          .select('company_name')
          .eq('id', data.partner_id)
          .single() as any;
        partnerName = partner?.company_name;
      }

      setDriver({
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
      });
    }
  }, [user, setDriver]);

  return {
    isLoading: loading,
    isAuthenticated: !!session,
    session,
    user,
    driver,
    signOut,
    refreshDriver,
  };
}
