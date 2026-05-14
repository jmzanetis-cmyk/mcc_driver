export interface DriverRow {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  status: 'pending_approval' | 'active' | 'inactive' | 'suspended' | 'deactivated';
  profile_photo_url: string | null;
  partner_id: string | null;
  is_online: boolean;
  can_drive_member_vehicle: boolean;
  total_rides_completed: number;
  average_rating: number;
  completion_rate: number;
  stripe_account_id: string | null;
  current_lat: number | null;
  current_lng: number | null;
}

export interface PartnerRow {
  id: string;
  company_name: string;
  invite_code: string | null;
}

export interface VehicleRow {
  id: string;
  driver_id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plate: string;
  is_active: boolean;
  insurance_expiry: string | null;
}

export interface RideRow {
  id: string;
  scenario: string;
  tier: string;
  status: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  estimated_fare: number;
  actual_fare: number | null;
  estimated_distance_miles: number;
  actual_distance_miles: number | null;
  tip_amount: number | null;
  member_rating: number | null;
  started_at: string | null;
  completed_at: string | null;
  member_vehicle_year: number | null;
  member_vehicle_make: string | null;
  member_vehicle_model: string | null;
  member_vehicle_color: string | null;
}

export interface AssignmentRow {
  id: string;
  ride_id: string;
  driver_id: string;
  role: string;
  status: string;
  driver_payout_amount: number | null;
  completed_at: string | null;
  drives_member_vehicle: boolean;
  carries_passenger: boolean;
  response_deadline: string;
  member_vehicle_description: string | null;
  member_vehicle_plate: string | null;
  payout_status: string | null;
  payout_id: string | null;
}

export interface PayoutRow {
  id: string;
  driver_id: string;
  amount: number;
  net_payout: number | null;
  platform_fee: number | null;
  method: 'instant' | 'standard';
  status: string;
  requested_at: string | null;
  completed_at: string | null;
  scheduled_date: string | null;
  stripe_transfer_id: string | null;
  card_last4: string | null;
  bank_last4: string | null;
  failed_reason: string | null;
  created_at: string;
}

export interface SupportIssueRow {
  id: string;
  driver_id: string;
  ride_id: string | null;
  issue_type: string;
  description: string;
  status: string;
  priority: string | null;
  created_at: string;
}

export interface AIConversationRow {
  id: string;
  driver_id: string;
  category: string;
  status: string;
  last_message_at: string;
  created_at: string;
  resolved_at: string | null;
}

export interface AIMessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  actions_taken: string | null;
  created_at: string;
}
