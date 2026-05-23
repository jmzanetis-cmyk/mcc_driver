// ============================================================
// MCC API — Safety routes
// POST /api/safety/alert   — panic button: SMS + DB record
// POST /api/safety/share-trip — generate shareable live-link
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";
import { randomBytes } from "crypto";

const router = Router();

// ── Lazy Twilio ──────────────────────────────────────────────────────────────
type TwilioClient = import("twilio").Twilio;
type TwilioFactory = (sid: string, token: string) => TwilioClient;
let _twilioClient: TwilioClient | null = null;
async function getTwilio(): Promise<TwilioClient | null> {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  if (!sid || !token) return null;
  if (_twilioClient) return _twilioClient;
  try {
    const mod = (await import("twilio")) as unknown as { default: TwilioFactory };
    _twilioClient = mod.default(sid, token);
    return _twilioClient;
  } catch {
    return null;
  }
}

async function sendSms(to: string, body: string): Promise<void> {
  const client = await getTwilio();
  const from = process.env["TWILIO_FROM_NUMBER"];
  if (!client || !from || !to) {
    logger.warn({ to }, "safety.sms_skipped (Twilio not configured)");
    return;
  }
  try {
    await client.messages.create({ to, from, body });
  } catch (err) {
    logger.error({ err, to }, "safety.sms_failed");
  }
}

function appBaseUrl(): string {
  const explicit = process.env["APP_BASE_URL"];
  if (explicit) return explicit.replace(/\/$/, "");
  const replit = (process.env["REPLIT_DOMAINS"] ?? "").split(",")[0]?.trim();
  return replit ? `https://${replit}` : "https://app.mycarconcierge.com";
}

// ── Auth helper ──────────────────────────────────────────────────────────────
async function getDriver(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data: driver } = await supabaseAdmin
    .from("drivers")
    .select("id, first_name, last_name, phone, emergency_contact_name, emergency_contact_phone")
    .eq("user_id", user.id)
    .single();
  return driver as {
    id: string;
    first_name: string;
    last_name: string;
    phone: string;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
  } | null;
}

// ── POST /api/safety/alert ───────────────────────────────────────────────────
router.post("/safety/alert", async (req: Request, res: Response) => {
  try {
    const driver = await getDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { lat, lng, rideId } = req.body as {
      lat?: unknown; lng?: unknown; rideId?: unknown;
    };

    const latNum = typeof lat === "number" ? lat : null;
    const lngNum = typeof lng === "number" ? lng : null;
    const rideIdStr = typeof rideId === "string" ? rideId : null;

    // Insert safety alert record
    const { data: alert, error: insertError } = await supabaseAdmin
      .from("safety_alerts")
      .insert({
        driver_id: driver.id,
        ride_id: rideIdStr,
        lat: latNum,
        lng: lngNum,
        alert_type: "panic",
        status: "active",
      })
      .select("id")
      .single();

    if (insertError) {
      logger.error({ err: insertError }, "safety.alert insert failed");
      res.status(500).json({ error: "Failed to record alert" });
      return;
    }

    // Send SMS to emergency contact
    const emergencyPhone = driver.emergency_contact_phone;
    if (emergencyPhone) {
      const locationStr = latNum != null && lngNum != null
        ? `Location: https://maps.google.com/?q=${latNum},${lngNum}`
        : "Location unavailable";
      const smsBody = `🚨 EMERGENCY: ${driver.first_name} ${driver.last_name} (MCC Driver) has triggered a panic alert. ${locationStr}. Alert ID: ${(alert as { id: string }).id}`;
      void sendSms(emergencyPhone, smsBody);
    }

    logger.info({ driverId: driver.id, alertId: (alert as { id: string }).id }, "safety.panic_alert");
    res.status(200).json({ success: true, alertId: (alert as { id: string }).id });
  } catch (err) {
    logger.error({ err }, "safety.alert unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/safety/share-trip ──────────────────────────────────────────────
router.post("/safety/share-trip", async (req: Request, res: Response) => {
  try {
    const driver = await getDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { rideId } = req.body as { rideId?: unknown };
    const rideIdStr = typeof rideId === "string" ? rideId : null;

    const token = randomBytes(16).toString("hex");

    await supabaseAdmin.from("safety_alerts").insert({
      driver_id: driver.id,
      ride_id: rideIdStr,
      alert_type: "share_trip",
      status: "active",
      share_token: token,
    });

    const shareUrl = `${appBaseUrl()}/driver/track/${token}`;
    res.status(200).json({ success: true, shareUrl, token });
  } catch (err) {
    logger.error({ err }, "safety.share-trip unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /api/safety/emergency-contact ─────────────────────────────────────
router.patch("/safety/emergency-contact", async (req: Request, res: Response) => {
  try {
    const driver = await getDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { name, phone } = req.body as { name?: unknown; phone?: unknown };
    if (typeof name !== "string" || typeof phone !== "string") {
      res.status(400).json({ error: "name and phone are required strings" });
      return;
    }

    await supabaseAdmin
      .from("drivers")
      .update({ emergency_contact_name: name.trim(), emergency_contact_phone: phone.trim() })
      .eq("id", driver.id);

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err }, "safety.emergency-contact unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
