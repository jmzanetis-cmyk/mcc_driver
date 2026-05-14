// ============================================================
// MCC Driver — Auth Service
// ============================================================
// Phone OTP authentication via Supabase Auth + Twilio
// ============================================================

import { supabase } from '@/services/supabase/client';

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

/**
 * Send OTP to phone number
 */
export async function sendOTP(phone: string): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    return { success: false, error: error.message };
  }
  return { success: true };
}

/**
 * Verify OTP code
 */
export async function verifyOTP(phone: string, code: string): Promise<{ success: boolean; isNewDriver: boolean; error?: string }> {
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token: code,
    type: 'sms',
  });

  if (error) {
    return { success: false, isNewDriver: false, error: error.message };
  }

  // Check if this user already has a driver profile
  const { data: driver } = await supabase
    .from('drivers')
    .select('id')
    .eq('user_id', data.user?.id)
    .single() as any;

  return {
    success: true,
    isNewDriver: !driver,
  };
}

/**
 * Get the current driver profile
 */
export async function getDriverProfile(): Promise<DriverProfile | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: driver, error } = await supabase
    .from('drivers')
    .select('*')
    .eq('user_id', user.id)
    .single() as any;

  if (error || !driver) return null;

  return {
    id: driver.id,
    userId: driver.user_id,
    firstName: driver.first_name,
    lastName: driver.last_name,
    email: driver.email,
    phone: driver.phone,
    status: driver.status,
    profilePhotoUrl: driver.profile_photo_url,
    partnerId: driver.partner_id,
    isOnline: driver.is_online,
    canDriveMemberVehicle: driver.can_drive_member_vehicle,
    totalRidesCompleted: driver.total_rides_completed,
    averageRating: driver.average_rating,
    completionRate: driver.completion_rate,
    stripeAccountId: driver.stripe_account_id,
  };
}

/**
 * Create a new driver application
 */
export async function createDriverApplication(data: {
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

  // If partner invite code provided, look up partner
  let partnerId: string | null = null;
  if (data.partnerInviteCode) {
    const { data: partner } = await supabase
      .from('transportation_partners')
      .select('id')
      .eq('invite_code', data.partnerInviteCode)
      .single() as any;

    if (partner) {
      partnerId = partner.id;
    }
  }

  const { data: driver, error } = await supabase
    .from('drivers')
    .insert({
      user_id: user.id,
      first_name: data.firstName,
      last_name: data.lastName,
      email: data.email,
      phone: data.phone,
      date_of_birth: data.dateOfBirth,
      drivers_license_number: data.driversLicenseNumber,
      drivers_license_state: data.driversLicenseState,
      drivers_license_expiry: data.driversLicenseExpiry,
      vehicle_make: data.vehicleMake,
      vehicle_model: data.vehicleModel,
      vehicle_year: data.vehicleYear,
      vehicle_color: data.vehicleColor,
      vehicle_plate: data.vehiclePlate,
      profile_photo_url: data.profilePhotoUrl,
      partner_id: partnerId,
      status: 'pending_approval',
    })
    .select('id')
    .single() as any;

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, driverId: driver?.id };
}

/**
 * Sign out
 */
export async function signOut(): Promise<void> {
  // Set driver offline before signing out
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from('drivers')
      .update({ is_online: false })
      .eq('user_id', user.id);
  }

  await supabase.auth.signOut();
}
