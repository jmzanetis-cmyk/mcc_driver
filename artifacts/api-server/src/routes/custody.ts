// ============================================================
// MCC API — Custody chain routes
//
//   GET  /custody/job-for-ride?ride_id=<uuid>
//   POST /custody/handoffs
//   POST /custody/handoffs/:id/release
//
// All custody tables live in Supabase (not Drizzle). Every read/write
// uses supabaseAdmin (service-role, bypasses RLS). The caller's uid is
// always derived from the verified JWT — never from the request body.
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

// ── constants ─────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f-]{36}$/i;

const VALID_LEG = new Set([
  "member_to_driver",
  "driver_to_shop",
  "shop_to_driver",
  "driver_to_member",
  "driver_to_driver",
  "member_to_provider",
  "provider_to_member",
]);

const VALID_ROLE = new Set(["member", "provider", "driver"]);

const ACTIVE_ASSIGNMENT_STATUSES = [
  "accepted",
  "en_route",
  "arrived",
  "in_progress",
  "completed",
];

// ── helpers ───────────────────────────────────────────────────────────────────

async function verifyToken(req: Request): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return user.id;
}

// Mirror of is_job_party() SQL function. Service-role bypasses RLS so we
// replicate the check in application code.
async function isJobParty(jobId: string, userId: string): Promise<boolean> {
  const jobRes = await supabaseAdmin
    .from("concierge_jobs")
    .select("id")
    .eq("id", jobId)
    .or(`member_id.eq.${userId},provider_id.eq.${userId}`)
    .maybeSingle();
  if (jobRes.data) return true;

  const handoffRes = await supabaseAdmin
    .from("custody_handoffs")
    .select("id")
    .eq("job_id", jobId)
    .or(`releasing_party_id.eq.${userId},receiving_party_id.eq.${userId}`)
    .limit(1);
  return !!(handoffRes.data && handoffRes.data.length > 0);
}

// ── GET /custody/job-for-ride ─────────────────────────────────────────────────

router.get("/custody/job-for-ride", async (req: Request, res: Response) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return; }

    const rideId = (req.query.ride_id as string | undefined)?.trim() ?? "";
    if (!UUID_RE.test(rideId)) { res.status(400).json({ error: "invalid ride_id" }); return; }

    // Resolve driver row from auth uid
    const driverRes = await supabaseAdmin
      .from("drivers")
      .select("id")
      .eq("profile_id", uid)
      .single();
    if (driverRes.error || !driverRes.data) {
      res.status(403).json({ error: "Driver record not found" }); return;
    }
    const driverId = (driverRes.data as { id: string }).id;

    // Verify active assignment for this ride
    const assignRes = await supabaseAdmin
      .from("driver_assignments")
      .select("id")
      .eq("ride_id", rideId)
      .eq("driver_id", driverId)
      .in("status", ACTIVE_ASSIGNMENT_STATUSES)
      .limit(1);
    if (assignRes.error || !assignRes.data || assignRes.data.length === 0) {
      res.status(403).json({ error: "No active assignment for this ride" }); return;
    }

    // Ride → service_request_id (= concierge_jobs.package_id)
    const rideRes = await supabaseAdmin
      .from("rides")
      .select("service_request_id")
      .eq("id", rideId)
      .single();
    if (rideRes.error || !rideRes.data) {
      res.status(404).json({ error: "Ride not found" }); return;
    }
    const row = rideRes.data as { service_request_id: string | null };
    if (!row.service_request_id) {
      res.status(404).json({ error: "Ride is not linked to a concierge job" }); return;
    }

    // service_request_id → concierge_job
    const jobRes = await supabaseAdmin
      .from("concierge_jobs")
      .select("id, member_id, provider_id")
      .eq("package_id", row.service_request_id)
      .single();
    if (jobRes.error || !jobRes.data) {
      res.status(404).json({ error: "Concierge job not found" }); return;
    }
    const job = jobRes.data as { id: string; member_id: string; provider_id: string | null };

    res.status(200).json({
      job_id:     job.id,
      member_id:  job.member_id,
      provider_id: job.provider_id ?? null,
    });
  } catch (err) {
    logger.error({ err }, "custody.job-for-ride unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /custody/handoffs ────────────────────────────────────────────────────

router.post("/custody/handoffs", async (req: Request, res: Response) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return; }

    const body = req.body as Record<string, unknown>;
    const jobId   = (typeof body.job_id === "string" ? body.job_id : "").trim();
    const leg     = (typeof body.leg    === "string" ? body.leg    : "").trim();
    const relRole = (typeof body.releasing_party_role === "string" ? body.releasing_party_role : "").trim();
    const recvId  = (typeof body.receiving_party_id  === "string" ? body.receiving_party_id  : "").trim();
    const recvRole= (typeof body.receiving_party_role === "string" ? body.receiving_party_role : "").trim();

    if (!UUID_RE.test(jobId))                   { res.status(400).json({ error: "job_id must be a valid UUID" }); return; }
    if (!VALID_LEG.has(leg))                    { res.status(400).json({ error: "invalid leg value" }); return; }
    if (!VALID_ROLE.has(relRole))               { res.status(400).json({ error: "invalid releasing_party_role" }); return; }
    if (!UUID_RE.test(recvId))                  { res.status(400).json({ error: "receiving_party_id must be a valid UUID" }); return; }
    if (!VALID_ROLE.has(recvRole))              { res.status(400).json({ error: "invalid receiving_party_role" }); return; }

    const party = await isJobParty(jobId, uid);
    if (!party) { res.status(403).json({ error: "Not a party to this job" }); return; }

    // Auto-sequence: one past current max (unique constraint handles races → client retries on 409)
    const seqRes = await supabaseAdmin
      .from("custody_handoffs")
      .select("sequence")
      .eq("job_id", jobId)
      .order("sequence", { ascending: false })
      .limit(1);
    const nextSeq = seqRes.data && seqRes.data.length > 0
      ? (seqRes.data[0] as { sequence: number }).sequence + 1
      : 1;

    // Snapshot provider at handoff time for any leg involving a driver — survives
    // driver record deletion (see custody_handoffs.on_behalf_of_provider_id).
    let onBehalfOfProviderId: string | null = null;
    if (relRole === "driver" || recvRole === "driver") {
      const jobRow = await supabaseAdmin
        .from("concierge_jobs")
        .select("provider_id")
        .eq("id", jobId)
        .single();
      onBehalfOfProviderId = (jobRow.data as { provider_id: string | null } | null)?.provider_id ?? null;
    }

    const ins = await supabaseAdmin
      .from("custody_handoffs")
      .insert({
        job_id:                   jobId,
        sequence:                 nextSeq,
        leg,
        releasing_party_id:       uid,
        releasing_party_role:     relRole,
        receiving_party_id:       recvId,
        receiving_party_role:     recvRole,
        on_behalf_of_provider_id: onBehalfOfProviderId,
        status:                   "pending",
      })
      .select()
      .single();

    if (ins.error) {
      logger.error({ err: ins.error }, "custody.create-handoff insert failed");
      // Unique constraint violation → sequence race
      const status = ins.error.code === "23505" ? 409 : 500;
      res.status(status).json({ error: ins.error.message }); return;
    }

    res.status(201).json({ handoff: ins.data });
  } catch (err) {
    logger.error({ err }, "custody.create-handoff unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /custody/handoffs/:id/release ───────────────────────────────────────

router.post("/custody/handoffs/:id/release", async (req: Request, res: Response) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return; }

    const handoffId = req.params.id ?? "";
    if (!UUID_RE.test(handoffId)) { res.status(400).json({ error: "invalid handoff id" }); return; }

    const hRes = await supabaseAdmin
      .from("custody_handoffs")
      .select("*")
      .eq("id", handoffId)
      .single();
    if (hRes.error || !hRes.data) { res.status(404).json({ error: "Handoff not found" }); return; }
    const h = hRes.data as {
      id: string; job_id: string; releasing_party_id: string;
      releasing_party_role: string; status: string;
    };

    if (h.releasing_party_id !== uid) {
      res.status(403).json({ error: "Only the releasing party may release this handoff" }); return;
    }
    if (h.status !== "pending") {
      res.status(409).json({ error: "Handoff must be in pending status to release" }); return;
    }

    const body = req.body as Record<string, unknown>;
    const lat         = typeof body.lat === "number"            ? body.lat            : null;
    const lng         = typeof body.lng === "number"            ? body.lng            : null;
    const gpsAccuracy = typeof body.gps_accuracy_m === "number" ? body.gps_accuracy_m : null;

    // Insert release attestation
    const atRes = await supabaseAdmin.from("custody_attestations").insert({
      handoff_id:   h.id,
      job_id:       h.job_id,
      party_id:     uid,
      party_role:   h.releasing_party_role,
      type:         "release",
      condition_ok: true,
      notes:        typeof body.notes === "string" ? body.notes : null,
    });
    if (atRes.error) {
      logger.error({ err: atRes.error }, "custody.release attestation insert failed");
      res.status(500).json({ error: "Failed to record attestation" }); return;
    }

    // Advance handoff to awaiting_receiver
    const upd = await supabaseAdmin
      .from("custody_handoffs")
      .update({
        status:                "awaiting_receiver",
        released_at:           new Date().toISOString(),
        handoff_lat:           lat,
        handoff_lng:           lng,
        handoff_gps_accuracy_m: gpsAccuracy,
      })
      .eq("id", handoffId);
    if (upd.error) {
      logger.error({ err: upd.error }, "custody.release handoff update failed");
      res.status(500).json({ error: "Failed to update handoff status" }); return;
    }

    res.status(200).json({ success: true, handoff_id: handoffId, status: "awaiting_receiver" });
  } catch (err) {
    logger.error({ err }, "custody.release unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
