import { supabase } from '@/services/supabase/client';
import type { DriverRow, PartnerRow } from '@/services/supabase/types';

export interface DriverProfile {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: 'pending_approval' | 'active' | 'inactive' | 'suspended' | 'deactivated';
  profilePhotoUrl?: string;
  partnerId?: string;
  isOnline: boolean;
  canDriveMemberVehicle: boolean;
  totalRidesCompleted: number;
  averageRating: number;
  completionRate: number;
  stripeAccountId?: string;
}

export async function sendOTP(phone: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: { shouldCreateUser: true },
  });
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function verifyOTP(phone: string, code: string): Promise<{ success: boolean; isNewDriver: boolean; error?: string }> {
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token: code,
    type: 'sms',
  });

  if (error) return { success: false, isNewDriver: false, error: error.message };

  const { data: driver } = await supabase
    .from('drivers')
    .select('id')
    .eq('user_id', data.user?.id)
    .single();

  return { success: true, isNewDriver: !driver };
}

export async function getDriverProfile(): Promise<DriverProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (error || !data) return null;

  const driver = data as unknown as DriverRow;

  return {
    id: driver.id,
    userId: driver.user_id,
    firstName: driver.first_name,
    lastName: driver.last_name,
    email: driver.email,
    phone: driver.phone,
    status: driver.status,
    profilePhotoUrl: driver.profile_photo_url ?? undefined,
    partnerId: driver.partner_id ?? undefined,
    isOnline: driver.is_online,
    canDriveMemberVehicle: driver.can_drive_member_vehicle,
    totalRidesCompleted: driver.total_rides_completed,
    averageRating: driver.average_rating,
    completionRate: driver.completion_rate,
    stripeAccountId: driver.stripe_account_id ?? undefined,
  };
}

export async function createDriverApplication(applicationData: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  driversLicenseNumber: string;
  driversLicenseState: string;
  driversLicenseExpiry: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  vehicleColor?: string;
  vehiclePlate?: string;
  profilePhotoUrl?: string;
  partnerInviteCode?: string;
}): Promise<{ success: boolean; driverId?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  let partnerId: string | null = null;
  if (applicationData.partnerInviteCode) {
    const { data: partnerData } = await supabase
      .from('transportation_partners')
      .select('id')
      .eq('invite_code', applicationData.partnerInviteCode)
      .single();
    const partner = partnerData as unknown as Pick<PartnerRow, 'id'> | null;
    if (partner) partnerId = partner.id;
  }

  const { data, error } = await supabase
    .from('drivers')
    .insert({
      user_id: user.id,
      first_name: applicationData.firstName,
      last_name: applicationData.lastName,
      email: applicationData.email,
      phone: applicationData.phone,
      date_of_birth: applicationData.dateOfBirth,
      drivers_license_number: applicationData.driversLicenseNumber,
      drivers_license_state: applicationData.driversLicenseState,
      drivers_license_expiry: applicationData.driversLicenseExpiry,
      vehicle_make: applicationData.vehicleMake,
      vehicle_model: applicationData.vehicleModel,
      vehicle_year: applicationData.vehicleYear,
      vehicle_color: applicationData.vehicleColor,
      vehicle_plate: applicationData.vehiclePlate,
      profile_photo_url: applicationData.profilePhotoUrl,
      partner_id: partnerId,
      status: 'pending_approval',
    })
    .select('id')
    .single();

  if (error) return { success: false, error: error.message };

  const inserted = data as unknown as { id: string } | null;
  return { success: true, driverId: inserted?.id };
}

export async function signOut(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.from('drivers').update({ is_online: false }).eq('user_id', user.id);
  }
  await supabase.auth.signOut();
}
