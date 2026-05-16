// ============================================================
// MCC API — Driver Location Router
// ============================================================
// Drivers push their GPS fix here while online. Updates both
// the local Drizzle `drivers` table (read by the dispatch
// matcher in routes/rides.ts) AND the Supabase `drivers` row
// (so any Supabase-Realtime/admin map subscribers see live
// positions).
//
// Server-side throttle: writes are skipped if the previous fix
// arrived less than MIN_WRITE_INTERVAL_MS ago. This keeps the
// device free to send at battery-friendly intervals (~10-15 s)
// without coordinating exact cadence with the server.
// ============================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db, driversTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { setSentryRequestIdentity } from "../lib/sentry";
import { supabaseAdmin } from "../lib/supabaseAdmin";

const router: IRouter = Router();

// ── Auth helper (mirrors the pattern used by routes/deviceTokens.ts) ──────────

interface SupabaseUser {
  id: string;
}

async function verifySupabaseToken(token: string): Promise<SupabaseUser | null> {
  const supabaseUrl = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const supabaseAnonKey =
    process.env["SUPABASE_ANON_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"];
  if (!supabaseUrl || !supabaseAnonKey) return null;
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as SupabaseUser;
    if (!user?.id) return null;
    setSentryRequestIdentity({ userId: user.id });
    return user;
  } catch {
    return null;
  }
}

async function requireUser(req: Request, res: Response): Promise<SupabaseUser | null> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const user = await verifySupabaseToken(auth.slice(7));
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return user;
}

// ── Throttle ──────────────────────────────────────────────────────────────────
// Per-driver write floor. The client may send faster (e.g. native
// background callbacks); we coalesce on the server.

const MIN_WRITE_INTERVAL_MS = 8_000;
const lastWriteAt = new Map<string, number>();

// ── Body schema ───────────────────────────────────────────────────────────────

const bodySchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
  heading: z.number().nullable().optional(),
  accuracy: z.number().nullable().optional(),
});

// ── POST /drivers/me/location ─────────────────────────────────────────────────

router.post("/drivers/me/location", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { lat, lng } = parsed.data;

  const [driver] = await db
    .select({ id: driversTable.id })
    .from(driversTable)
    .where(eq(driversTable.userId, user.id))
    .limit(1);

  if (!driver) {
    res.status(404).json({ error: "No driver profile for this user" });
    return;
  }

  const now = Date.now();
  const previous = lastWriteAt.get(driver.id) ?? 0;
  if (now - previous < MIN_WRITE_INTERVAL_MS) {
    res.status(202).json({ throttled: true });
    return;
  }
  lastWriteAt.set(driver.id, now);

  // Write to local Postgres (read by dispatch eligibility query in routes/rides.ts).
  // `locationUpdatedAt` is the server-side freshness marker used by dispatch /
  // admin monitoring to flag stale drivers.
  const nowIso = new Date();
  await db
    .update(driversTable)
    .set({ currentLat: lat, currentLng: lng, locationUpdatedAt: nowIso })
    .where(eq(driversTable.id, driver.id));

  // Mirror to Supabase so the admin map / any Realtime listeners stay in sync.
  // Best-effort — a Supabase outage must not break dispatch.
  try {
    const { error: mirrorErr } = await supabaseAdmin
      .from("drivers")
      .update({
        current_lat: lat,
        current_lng: lng,
        location_updated_at: nowIso.toISOString(),
      })
      .eq("id", driver.id);
    if (mirrorErr) {
      logger.warn(
        { err: mirrorErr.message, driverId: driver.id },
        "driver_location.supabase_mirror_error",
      );
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), driverId: driver.id },
      "driver_location.supabase_mirror_failed",
    );
  }

  res.json({ ok: true });
});

export default router;
