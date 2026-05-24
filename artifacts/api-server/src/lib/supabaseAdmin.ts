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

export interface InsertedAssignment {
  id: string;
  driver_id: string;
}

export async function insertAssignmentViaSupabase(
  values: DriverAssignmentInsert | DriverAssignmentInsert[],
): Promise<InsertedAssignment[]> {
  const rows = Array.isArray(values) ? values : [values];

  const { data, error } = await supabaseAdmin
    .from("driver_assignments")
    .insert(rows)
    .select("id, driver_id");

  if (error) {
    logger.error({ error }, "supabaseAdmin: failed to insert driver_assignment");
    throw new Error(`Supabase insert failed: ${error.message}`);
  }
  return (data ?? []) as InsertedAssignment[];
}

/**
 * Update one or more driver_assignment rows via Supabase HTTPS so that
 * Realtime UPDATE events fire to subscribed driver apps. This is the
 * counterpart to insertAssignmentViaSupabase — used for status changes
 * that drivers must receive in real time (e.g. cancellation).
 */
export async function updateAssignmentViaSupabase(
  assignmentIds: string[],
  values: Record<string, unknown>,
): Promise<void> {
  if (assignmentIds.length === 0) return;

  const { error } = await supabaseAdmin
    .from("driver_assignments")
    .update(values)
    .in("id", assignmentIds);

  if (error) {
    logger.error({ error }, "supabaseAdmin: failed to update driver_assignment");
    throw new Error(`Supabase update failed: ${error.message}`);
  }
}

/**
 * Update a ride row in Supabase Postgres via HTTPS so that Realtime
 * UPDATE events fire to subscribed driver apps (useRideCancellation).
 * Must be called alongside any local Drizzle write to keep Supabase in
 * sync and ensure the driver app receives the real-time notification.
 *
 * Prerequisite: the rides table must be in the supabase_realtime
 * publication — see scripts/sql/enable-rides-realtime.sql.
 */
export async function updateRideViaSupabase(
  rideId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("rides")
    .update(values)
    .eq("id", rideId);

  if (error) {
    logger.error({ error, rideId }, "supabaseAdmin: failed to update ride");
    throw new Error(`Supabase ride update failed: ${error.message}`);
  }
}

/**
 * Upsert a tandem_jobs row to Supabase Postgres via HTTPS so Realtime
 * INSERT/UPDATE events fire to the ride-along driver dashboard. The local
 * Drizzle row remains the source of truth; Supabase is used purely as a
 * Realtime notification bus (mirrors the driver_assignments pattern).
 *
 * Prerequisite: the tandem_jobs table must be added to the
 * supabase_realtime publication — see
 * scripts/sql/enable-tandem-jobs-realtime.sql.
 */
export async function upsertTandemJobViaSupabase(
  tandemJobId: string,
  values: Record<string, unknown>,
): Promise<void> {
  const row = { id: tandemJobId, ...values };
  const { error } = await supabaseAdmin
    .from("tandem_jobs")
    .upsert(row, { onConflict: "id" });

  if (error) {
    logger.error({ error, tandemJobId }, "supabaseAdmin: failed to upsert tandem_job");
    throw new Error(`Supabase tandem_job upsert failed: ${error.message}`);
  }
}
