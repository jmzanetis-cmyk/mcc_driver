import { useCallback } from 'react';
import { useAuthStore, type DriverProfile } from '@/store/authStore';
import { supabase } from '@/services/supabase/client';
import type { DriverRow, PartnerRow } from '@/services/supabase/types';

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
      .single();

    if (data) {
      const row = data as unknown as DriverRow;
      let partnerName: string | undefined;
      if (row.partner_id) {
        const { data: partnerData } = await supabase
          .from('transportation_partners')
          .select('company_name')
          .eq('id', row.partner_id)
          .single();
        const partner = partnerData as unknown as PartnerRow | null;
        partnerName = partner?.company_name;
      }

      setDriver({
        id: row.id,
        userId: row.user_id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        phone: row.phone,
        status: row.status,
        profilePhotoUrl: row.profile_photo_url ?? undefined,
        partnerId: row.partner_id ?? undefined,
        partnerName,
        isOnline: row.is_online,
        canDriveMemberVehicle: row.can_drive_member_vehicle,
        totalRidesCompleted: row.total_rides_completed,
        averageRating: row.average_rating,
        completionRate: row.completion_rate,
        stripeAccountId: row.stripe_account_id ?? undefined,
        backgroundCheckPassed: row.background_check_passed ?? false,
        licenseDocumentPath: row.license_document_path ?? undefined,
        insuranceDocumentPath: row.insurance_document_path ?? undefined,
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
