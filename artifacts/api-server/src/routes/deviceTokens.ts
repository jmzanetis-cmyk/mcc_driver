// ============================================================
// MCC API — Device Tokens Router
// ============================================================
// Drivers (and ride-along drivers) register a Web Push / FCM /
// APNs token here on sign-in so the server can deliver real
// native push notifications when the app is closed.

import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  deviceTokensTable,
  driversTable,
  rideAlongDriversTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { setSentryRequestIdentity } from "../lib/sentry";
import { getVapidPublicKey } from "../lib/webPush";

const router: IRouter = Router();

// ── Auth helper (mirrors the pattern used by other routers) ───────────────────

interface SupabaseUser {
  id: string;
  email?: string;
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

// Resolve which owner (driver vs ride-along driver) this Supabase user maps to.
async function resolveOwner(
  userId: string,
): Promise<{ kind: "driver" | "ride_along_driver"; id: string } | null> {
  const [d] = await db
    .select({ id: driversTable.id })
    .from(driversTable)
    .where(eq(driversTable.userId, userId))
    .limit(1);
  if (d) return { kind: "driver", id: d.id };
  const [r] = await db
    .select({ id: rideAlongDriversTable.id })
    .from(rideAlongDriversTable)
    .where(eq(rideAlongDriversTable.userId, userId))
    .limit(1);
  if (r) return { kind: "ride_along_driver", id: r.id };
  return null;
}

// ── Public VAPID key (browsers need it to subscribe) ──────────────────────────

router.get("/device-tokens/vapid-key", (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) {
    res.status(503).json({ error: "Push notifications not configured" });
    return;
  }
  res.json({ publicKey: key });
});

// ── Register / refresh a token ────────────────────────────────────────────────

const registerBodySchema = z.object({
  platform: z.enum(["web", "fcm", "apns"]),
  token: z.string().min(1),
  p256dh: z.string().optional(),
  auth: z.string().optional(),
  userAgent: z.string().optional(),
});

router.post("/device-tokens", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const owner = await resolveOwner(user.id);
  if (!owner) {
    res.status(404).json({ error: "No driver profile for this user" });
    return;
  }
  const parsed = registerBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;
  if (body.platform === "web" && (!body.p256dh || !body.auth)) {
    res.status(400).json({ error: "Web push requires p256dh and auth keys" });
    return;
  }

  const now = new Date();
  const [existing] = await db
    .select()
    .from(deviceTokensTable)
    .where(eq(deviceTokensTable.token, body.token))
    .limit(1);

  if (existing) {
    await db
      .update(deviceTokensTable)
      .set({
        ownerKind: owner.kind,
        ownerId: owner.id,
        platform: body.platform,
        p256dh: body.p256dh ?? null,
        auth: body.auth ?? null,
        userAgent: body.userAgent ?? null,
        lastSeenAt: now,
        revokedAt: null,
      })
      .where(eq(deviceTokensTable.id, existing.id));
    logger.info({ tokenId: existing.id, owner }, "device_tokens.refreshed");
    res.json({ id: existing.id, refreshed: true });
    return;
  }

  const [inserted] = await db
    .insert(deviceTokensTable)
    .values({
      ownerKind: owner.kind,
      ownerId: owner.id,
      platform: body.platform,
      token: body.token,
      p256dh: body.p256dh ?? null,
      auth: body.auth ?? null,
      userAgent: body.userAgent ?? null,
    })
    .returning({ id: deviceTokensTable.id });
  logger.info({ tokenId: inserted?.id, owner }, "device_tokens.registered");
  res.status(201).json({ id: inserted?.id, refreshed: false });
});

// ── Revoke a token (called on sign-out) ───────────────────────────────────────

router.delete("/device-tokens", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const owner = await resolveOwner(user.id);
  if (!owner) {
    res.status(204).end();
    return;
  }
  const token = typeof req.body?.token === "string" ? (req.body.token as string) : null;
  if (!token) {
    res.status(400).json({ error: "Missing token" });
    return;
  }
  await db
    .update(deviceTokensTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(deviceTokensTable.token, token),
        eq(deviceTokensTable.ownerKind, owner.kind),
        eq(deviceTokensTable.ownerId, owner.id),
      ),
    );
  logger.info({ owner }, "device_tokens.revoked");
  res.status(204).end();
});

export default router;
