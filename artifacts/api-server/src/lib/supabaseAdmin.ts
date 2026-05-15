import { createClient } from "@supabase/supabase-js";
import { logger } from "./logger";

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!supabaseUrl || !serviceRoleKey) {
  logger.warn("VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — Realtime inserts will fail");
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface RideInsert {
  id: string;
  scenario: string;
  tier: string;
  status: string;
  member_id?: string | null;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  estimated_fare: number;
  estimated_distance_miles: number;
  member_vehicle_year?: number | null;
  member_vehicle_make?: string | null;
  member_vehicle_model?: string | null;
  member_vehicle_color?: string | null;
}

export async function insertRideViaSupabase(values: RideInsert): Promise<void> {
  const { error } = await supabaseAdmin.from("rides").insert([values]);
  if (error) {
    logger.error({ error }, "supabaseAdmin: failed to insert ride");
    throw new Error(`Supabase ride insert failed: ${error.message}`);
  }
}

export interface DriverAssignmentInsert {
  ride_id: string;
  driver_id: string;
  role: string;
  status: string;
  drives_member_vehicle: boolean;
  carries_passenger: boolean;
  response_deadline: string;
  member_vehicle_description?: string | null;
  member_vehicle_plate?: string | null;
}

export async function insertAssignmentViaSupabase(
  values: DriverAssignmentInsert | DriverAssignmentInsert[],
): Promise<void> {
  const rows = Array.isArray(values) ? values : [values];

  const { error } = await supabaseAdmin
    .from("driver_assignments")
    .insert(rows);

  if (error) {
    logger.error({ error }, "supabaseAdmin: failed to insert driver_assignment");
    throw new Error(`Supabase insert failed: ${error.message}`);
  }
}
