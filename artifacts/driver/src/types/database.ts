// ============================================================
// MCC Driver — Database Types
// ============================================================
// In production, generate this with:
//   supabase gen types typescript --project-id YOUR_ID > src/types/database.ts
//
// This placeholder defines the shape so TypeScript is happy.
// Replace with generated types once Supabase is running.
// ============================================================

export interface Database {
  public: {
    Tables: {
      drivers: {
        Row: {
          id: string;
          user_id: string;
          first_name: string;
          last_name: string;
          email: string;
          phone: string;
          status: 'pending_approval' | 'active' | 'inactive' | 'suspended' | 'deactivated';
          profile_photo_url: string | null;
          license_document_path: string | null;
          insurance_document_path: string | null;
          background_check_passed: boolean;
          partner_id: string | null;
          is_online: boolean;
          can_drive_member_vehicle: boolean;
          total_rides_completed: number;
          average_rating: number;
          completion_rate: number;
          stripe_account_id: string | null;
          current_lat: number | null;
          current_lng: number | null;
          location_updated_at: string | null;
          preferred_partner_id: string | null;
          document_rejection_reason: string | null;
          can_do_rideshare: boolean;
          can_do_delivery: boolean;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['drivers']['Row']> & {
          first_name: string;
          last_name: string;
          email: string;
          phone: string;
        };
        Update: Partial<Database['public']['Tables']['drivers']['Row']>;
      };
      rides: {
        Row: {
          id: string;
          scenario: string;
          tier: string;
          status: string;
          member_id: string | null;
          member_phone: string | null;
          member_name: string | null;
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
          member_vehicle_plate: string | null;
          tandem_required: boolean;
          tandem_mode: string | null;
          service_type: string;
          package_description: string | null;
          pickup_contact_name: string | null;
          pickup_contact_phone: string | null;
          dropoff_contact_name: string | null;
          dropoff_contact_phone: string | null;
          subsidy_percent: number | null;
          request_source: string | null;
          requested_by_user_id: string | null;
          scheduled_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['rides']['Row']>;
        Update: Partial<Database['public']['Tables']['rides']['Row']>;
      };
      driver_assignments: {
        Row: {
          id: string;
          ride_id: string;
          driver_id: string;
          role: 'primary' | 'chase';
          status: string;
          drives_member_vehicle: boolean;
          drives_partner_vehicle: boolean;
          carries_passenger: boolean;
          dispatched_at: string | null;
          response_deadline: string | null;
          accepted_at: string | null;
          rejected_at: string | null;
          en_route_at: string | null;
          arrived_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          driver_payout_amount: number | null;
          payout_status: string;
          payout_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['driver_assignments']['Row']>;
        Update: Partial<Database['public']['Tables']['driver_assignments']['Row']>;
      };
      driver_vehicles: {
        Row: {
          id: string;
          driver_id: string;
          make: string;
          model: string;
          year: number;
          color: string;
          plate: string;
          is_active: boolean;
          insurance_expiry: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['driver_vehicles']['Row']>;
        Update: Partial<Database['public']['Tables']['driver_vehicles']['Row']>;
      };
      driver_payouts: {
        Row: {
          id: string;
          driver_id: string;
          amount: number | null;
          net_payout: number | null;
          platform_fee: number | null;
          method: string;
          status: string;
          scheduled_date: string | null;
          completed_at: string | null;
          failed_reason: string | null;
          requested_at: string | null;
          card_last4: string | null;
          bank_last4: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['driver_payouts']['Row']>;
        Update: Partial<Database['public']['Tables']['driver_payouts']['Row']>;
      };
      driver_earnings: {
        Row: {
          id: string;
          driver_id: string;
          job_id: string | null;
          leg_id: string | null;
          ride_id: string | null;
          amount_cents: number;
          kind: 'base' | 'tip' | 'bonus' | 'adjustment' | 'tip_share';
          notes: string | null;
          recorded_at: string;
          payout_status: string;
          stripe_transfer_id: string | null;
          paid_at: string | null;
          payout_error: string | null;
          cashout_id: string | null;
          tip_shared_from: string | null;
        };
        Insert: Partial<Database['public']['Tables']['driver_earnings']['Row']>;
        Update: Partial<Database['public']['Tables']['driver_earnings']['Row']>;
      };
      driver_support_issues: {
        Row: {
          id: string;
          driver_id: string;
          ride_id: string | null;
          issue_type: string;
          description: string;
          status: string;
          priority: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['driver_support_issues']['Row']>;
        Update: Partial<Database['public']['Tables']['driver_support_issues']['Row']>;
      };
      ai_conversations: {
        Row: {
          id: string;
          driver_id: string;
          category: string;
          status: string;
          last_message_at: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['ai_conversations']['Row']>;
        Update: Partial<Database['public']['Tables']['ai_conversations']['Row']>;
      };
      ai_messages: {
        Row: {
          id: string;
          conversation_id: string;
          role: string;
          content: string;
          actions_taken: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['ai_messages']['Row']>;
        Update: Partial<Database['public']['Tables']['ai_messages']['Row']>;
      };
      driver_location_history: {
        Row: {
          id: string;
          driver_id: string;
          ride_id: string | null;
          lat: number;
          lng: number;
          heading: number | null;
          recorded_at: string;
        };
        Insert: Partial<Database['public']['Tables']['driver_location_history']['Row']>;
        Update: Partial<Database['public']['Tables']['driver_location_history']['Row']>;
      };
      transportation_partners: {
        Row: {
          id: string;
          company_name: string;
          invite_code: string | null;
          stripe_account_id: string | null;
        };
        Insert: Partial<Database['public']['Tables']['transportation_partners']['Row']>;
        Update: Partial<Database['public']['Tables']['transportation_partners']['Row']>;
      };
    };
    Functions: {
      find_nearest_drivers: {
        Args: {
          p_lat: number;
          p_lng: number;
          p_radius_miles?: number;
          p_needs_vehicle_capability?: boolean;
          p_exclude_driver_ids?: string[];
          p_limit?: number;
        };
        Returns: Array<{
          driver_id: string;
          driver_name: string;
          distance_miles: number;
          average_rating: number;
          completion_rate: number;
        }>;
      };
    };
  };
}
