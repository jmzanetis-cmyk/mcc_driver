// ============================================================
// MCC API — POST /api/rides/:rideId/messages
// ============================================================
// Inserts a chat message from the driver and optionally sends
// an SMS to the member via Twilio so they see it even if the
// member app is not open.
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

type TwilioClient = import("twilio").Twilio;
type TwilioFactory = (sid: string, token: string) => TwilioClient;
let twilioClient: TwilioClient | null = null;

async function getTwilioClient(): Promise<TwilioClient | null> {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!sid || !token) return null;
  if (twilioClient) return twilioClient;
  try {
    const mod = (await import("twilio")) as unknown as { default: TwilioFactory };
    twilioClient = mod.default(sid, token);
    return twilioClient;
  } catch (err) {
    logger.error({ err }, "rideMessages: failed to init Twilio client");
    return null;
  }
}

router.post("/rides/:rideId/messages", async (req: Request, res: Response) => {
  try {
    // ── 1. Authenticate ──────────────────────────────────────
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing authorization token" });
      return;
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    // ── 2. Validate body ─────────────────────────────────────
    const { rideId } = req.params;
    const { body: msgBody } = req.body as { body?: string };

    if (!msgBody || typeof msgBody !== "string" || msgBody.trim().length === 0) {
      res.status(400).json({ error: "body is required" });
      return;
    }

    if (msgBody.length > 500) {
      res.status(400).json({ error: "Message exceeds 500 characters" });
      return;
    }

    const trimmed = msgBody.trim();

    // ── 3. Look up driver ────────────────────────────────────
    const { data: driver, error: driverError } = await supabaseAdmin
      .from("drivers")
      .select("id, first_name")
      .eq("profile_id", user.id)
      .single();

    if (driverError || !driver) {
      res.status(404).json({ error: "Driver profile not found" });
      return;
    }

    // ── 4. Verify assignment ─────────────────────────────────
    const { data: assignment } = await supabaseAdmin
      .from("driver_assignments")
      .select("id")
      .eq("ride_id", rideId)
      .eq("driver_id", driver.id)
      .maybeSingle();

    if (!assignment) {
      res.status(403).json({ error: "Driver not assigned to this ride" });
      return;
    }

    // ── 5. Insert message ────────────────────────────────────
    const { data: message, error: insertError } = await supabaseAdmin
      .from("ride_messages")
      .insert({
        ride_id: rideId,
        sender_id: user.id,
        sender_role: "driver",
        body: trimmed,
      })
      .select("id, created_at")
      .single();

    if (insertError) {
      logger.error({ err: insertError, rideId }, "Failed to insert ride message");
      res.status(500).json({ error: "Failed to save message" });
      return;
    }

    // ── 6. SMS to member (non-blocking) ──────────────────────
    void (async () => {
      try {
        const { data: ride } = await supabaseAdmin
          .from("rides")
          .select("member_phone")
          .eq("id", rideId)
          .maybeSingle();

        const memberPhone = (ride as { member_phone?: string | null } | null)?.member_phone;
        if (!memberPhone) return;

        const client = await getTwilioClient();
        const from = process.env["TWILIO_FROM_NUMBER"];
        if (!client || !from) return;

        await client.messages.create({
          to: memberPhone,
          from,
          body: `Your MCC driver ${driver.first_name} says: "${trimmed}"`,
        });
      } catch (err) {
        logger.warn({ err, rideId }, "rideMessages: SMS delivery failed (non-fatal)");
      }
    })();

    res.status(201).json({ success: true, messageId: message.id, createdAt: message.created_at });
  } catch (err) {
    logger.error({ err }, "Unhandled error in rideMessages route");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
