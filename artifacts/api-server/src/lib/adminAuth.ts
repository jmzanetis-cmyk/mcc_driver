// ============================================================
// MCC API — Shared admin authentication
// ============================================================
// Database-backed admin role check.
//
// On first call (or seedAdminsFromEnv()), if the admin_users table
// is empty AND ADMIN_EMAILS is set, the env value is used to seed
// the initial admin row(s). After that, the table is the source
// of truth — staff can be added/removed without a code deploy.
// ============================================================

import type { Request, Response } from "express";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { adminUsersTable } from "@workspace/db/schema";
import { logger } from "./logger";
import { setSentryRequestIdentity } from "./sentry";

export interface SupabaseUser {
  id: string;
  email?: string;
}

export async function verifySupabaseToken(token: string): Promise<SupabaseUser | null> {
  const supabaseUrl = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const supabaseAnonKey = process.env["SUPABASE_ANON_KEY"] ?? process.env["VITE_SUPABASE_ANON_KEY"];
  if (!supabaseUrl || !supabaseAnonKey) {
    logger.warn("Supabase env vars not configured — cannot verify JWT");
    return null;
  }
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

export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

/** Check if an email is currently an admin (DB lookup). */
export async function isAdminEmail(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const [row] = await db
    .select({ id: adminUsersTable.id })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.email, normalized))
    .limit(1);
  return !!row;
}

/**
 * Seed the admin_users table from the ADMIN_EMAILS env var if (and only if)
 * the table is currently empty. Safe to call on every startup — it no-ops
 * once any admin row exists. Logs a warning if no env var is set and table
 * is empty so operators know the system has no admins.
 */
export async function seedAdminsFromEnv(): Promise<void> {
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(adminUsersTable);

    if (count > 0) {
      logger.info({ count }, "admin_users table populated; skipping env seed");
      return;
    }

    const envValue = process.env["ADMIN_EMAILS"];
    if (!envValue) {
      logger.warn(
        "admin_users table is empty AND ADMIN_EMAILS not set — no one can access admin endpoints",
      );
      return;
    }

    const emails = envValue
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (emails.length === 0) return;

    await db
      .insert(adminUsersTable)
      .values(emails.map((email) => ({ email, createdBy: "env_seed" })))
      .onConflictDoNothing({ target: adminUsersTable.email });

    logger.info({ count: emails.length }, "Seeded admin_users from ADMIN_EMAILS env var");
  } catch (err) {
    logger.error({ err }, "Failed to seed admin_users from env");
  }
}

/**
 * Express middleware-style helper: verifies the bearer token AND that the
 * caller is in the admin_users table. Writes the appropriate error response
 * and returns null on failure.
 */
export async function requireAdminAuth(
  req: Request,
  res: Response,
): Promise<SupabaseUser | null> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Unauthorized — authentication required" });
    return null;
  }

  const user = await verifySupabaseToken(token);
  if (!user) {
    res.status(401).json({ error: "Unauthorized — invalid or expired token" });
    return null;
  }

  if (!user.email) {
    res.status(403).json({ error: "Forbidden — user account has no email" });
    return null;
  }

  const allowed = await isAdminEmail(user.email);
  if (!allowed) {
    logger.info({ email: user.email }, "Admin access denied — email not in admin_users");
    res.status(403).json({ error: "Forbidden — not an admin" });
    return null;
  }

  return user;
}
