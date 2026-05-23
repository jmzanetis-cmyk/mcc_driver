// ============================================================
// MCC API — Support ticket routes
// POST /api/support/tickets     — create ticket
// GET  /api/support/tickets     — list driver's tickets
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

async function getDriverId(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data } = await supabaseAdmin.from("drivers").select("id").eq("user_id", user.id).single();
  return (data as { id: string } | null)?.id ?? null;
}

// ── POST /api/support/tickets ────────────────────────────────────────────────
router.post("/support/tickets", async (req: Request, res: Response) => {
  try {
    const driverId = await getDriverId(req.headers.authorization);
    if (!driverId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { subject, description } = req.body as { subject?: unknown; description?: unknown };
    if (typeof subject !== "string" || !subject.trim()) {
      res.status(400).json({ error: "subject is required" }); return;
    }
    if (typeof description !== "string" || !description.trim()) {
      res.status(400).json({ error: "description is required" }); return;
    }

    const { data, error } = await supabaseAdmin
      .from("support_tickets")
      .insert({
        driver_id: driverId,
        subject: subject.trim().slice(0, 200),
        description: description.trim().slice(0, 5000),
        status: "open",
      })
      .select("id")
      .single();

    if (error) {
      logger.error({ err: error }, "supportTickets.create failed");
      res.status(500).json({ error: "Failed to create ticket" }); return;
    }

    res.status(201).json({ success: true, ticketId: (data as { id: string }).id });
  } catch (err) {
    logger.error({ err }, "supportTickets.create unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/support/tickets ─────────────────────────────────────────────────
router.get("/support/tickets", async (req: Request, res: Response) => {
  try {
    const driverId = await getDriverId(req.headers.authorization);
    if (!driverId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { data, error } = await supabaseAdmin
      .from("support_tickets")
      .select("id, subject, description, status, created_at, resolved_at")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) { res.status(500).json({ error: "Failed to fetch tickets" }); return; }
    res.status(200).json({ tickets: data ?? [] });
  } catch (err) {
    logger.error({ err }, "supportTickets.get unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
