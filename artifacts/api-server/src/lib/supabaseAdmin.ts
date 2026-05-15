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
