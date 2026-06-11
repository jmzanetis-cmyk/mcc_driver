// ============================================================
// MCC API — Tracking ops-flag proxy
//
//   POST /api/tracking/flag
//
// The driver app cannot write to ops_flags directly (admin-only
// RLS). This endpoint verifies the driver's JWT, then uses the
// service-role client to call upsert_ops_flag(), which dedupes
// open flags of the same kind per job before inserting.
//
// Only client-reportable flag kinds are accepted here:
//   movement_before_attestation — driver moved > 200 m before
//     receiving attestation completed (publisher detects this).
//   tandem_separation           — lead/chase distance > 2 km for
//     > 2 min (publisher detects on either device).
//
// Server-side flag kinds (dead_publisher, stale_active_leg,
// telemetry_gap) are emitted by pg_cron, not by the client.
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";

const router = Router();

const UUID_RE = /^[0-9a-f-]{36}$/i;

const CLIENT_FLAG_KINDS = new Set([
  "movement_before_attestation",
  "tandem_separation",
]);

async function verifyToken(req: Request): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return user.id;
}

router.post("/tracking/flag", async (req: Request, res: Response) => {
  try {
    const uid = await verifyToken(req);
    if (!uid) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { kind, job_id, handoff_id, detail } = req.body ?? {};

    if (!kind || !CLIENT_FLAG_KINDS.has(kind)) {
      res.status(400).json({ error: `kind must be one of: ${[...CLIENT_FLAG_KINDS].join(", ")}` });
      return;
    }
    if (!job_id || !UUID_RE.test(job_id)) {
      res.status(400).json({ error: "job_id must be a valid UUID" });
      return;
    }
    if (handoff_id && !UUID_RE.test(handoff_id)) {
      res.status(400).json({ error: "handoff_id must be a valid UUID" });
      return;
    }

    const { error: rpcErr } = await supabaseAdmin.rpc("upsert_ops_flag", {
      p_kind:       kind,
      p_severity:   "review",
      p_job_id:     job_id,
      p_handoff_id: handoff_id ?? null,
      p_driver_id:  uid,
      p_detail:     (detail && typeof detail === "object") ? detail : {},
    });

    if (rpcErr) {
      console.error("[tracking/flag] upsert_ops_flag failed:", rpcErr.message);
      res.status(500).json({ error: rpcErr.message });
      return;
    }

    res.status(204).send();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "internal error";
    console.error("[tracking/flag] threw:", msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
