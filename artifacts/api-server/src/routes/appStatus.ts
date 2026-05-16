// ============================================================
// MCC API — App Status (kill switch + forced update)
// ============================================================
// Public, unauthenticated endpoint the driver app polls on launch
// and on resume-from-background. Backed by the single-row
// `app_config` table so admins can change the kill switch or
// minimum supported version without a redeploy.
//
// Also exposes admin GET/PUT to read and edit the same row.
// ============================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { appConfigTable, type AppConfig } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { requireAdminAuth } from "../lib/adminAuth";

const router: IRouter = Router();

const GLOBAL_ID = "global";

// Lazily insert + cache the singleton row so cold callers don't 404.
async function readOrCreateGlobalConfig(): Promise<AppConfig> {
  const [existing] = await db
    .select()
    .from(appConfigTable)
    .where(eq(appConfigTable.id, GLOBAL_ID))
    .limit(1);
  if (existing) return existing;

  const [inserted] = await db
    .insert(appConfigTable)
    .values({ id: GLOBAL_ID })
    .onConflictDoNothing({ target: appConfigTable.id })
    .returning();
  if (inserted) return inserted;

  // Lost an insert race — re-read.
  const [row] = await db
    .select()
    .from(appConfigTable)
    .where(eq(appConfigTable.id, GLOBAL_ID))
    .limit(1);
  if (!row) {
    throw new Error("app_config global row missing after upsert");
  }
  return row;
}

// ── PUBLIC: GET /api/app/status ──────────────────────────────────────────────
// Cacheable for ~60 s so launch storms don't hammer the API. We deliberately
// avoid touching anything else here (no auth, no joins) so this endpoint stays
// up even when the rest of the API is degraded — it's the ops escape hatch.

router.get("/app/status", async (_req: Request, res: Response): Promise<void> => {
  try {
    const cfg = await readOrCreateGlobalConfig();
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      minSupportedVersion: cfg.minSupportedVersion,
      latestVersion: cfg.latestVersion,
      outageMessage: cfg.outageMessage ?? null,
      appStoreUrl: cfg.appStoreUrl ?? null,
    });
  } catch (err) {
    logger.error({ err }, "app_status_read_failed");
    // Fail open with safe defaults so a DB blip doesn't brick every install.
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      minSupportedVersion: "0.0.0",
      latestVersion: "0.0.0",
      outageMessage: null,
      appStoreUrl: null,
    });
  }
});

// ── ADMIN: GET /api/admin/app-config ─────────────────────────────────────────

router.get(
  "/admin/app-config",
  async (req: Request, res: Response): Promise<void> => {
    const admin = await requireAdminAuth(req, res);
    if (!admin) return;
    const cfg = await readOrCreateGlobalConfig();
    res.json(cfg);
  },
);

// ── ADMIN: PUT /api/admin/app-config ─────────────────────────────────────────

const semverRegex = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

const UpdateAppConfigBody = z.object({
  minSupportedVersion: z.string().regex(semverRegex, "Must be semver like 1.2.3").optional(),
  latestVersion: z.string().regex(semverRegex, "Must be semver like 1.2.3").optional(),
  outageMessage: z.string().trim().max(500).nullable().optional(),
  appStoreUrl: z
    .string()
    .trim()
    .max(500)
    .url("Must be a valid URL")
    .nullable()
    .optional(),
});

router.put(
  "/admin/app-config",
  async (req: Request, res: Response): Promise<void> => {
    const admin = await requireAdminAuth(req, res);
    if (!admin) return;

    const parsed = UpdateAppConfigBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
      return;
    }

    // Ensure the row exists, then patch only the provided fields.
    await readOrCreateGlobalConfig();

    const patch: Partial<typeof appConfigTable.$inferInsert> = {
      updatedAt: new Date(),
      updatedBy: admin.email ?? null,
    };
    if (parsed.data.minSupportedVersion !== undefined) {
      patch.minSupportedVersion = parsed.data.minSupportedVersion;
    }
    if (parsed.data.latestVersion !== undefined) {
      patch.latestVersion = parsed.data.latestVersion;
    }
    if (parsed.data.outageMessage !== undefined) {
      const trimmed = parsed.data.outageMessage?.trim();
      patch.outageMessage = trimmed ? trimmed : null;
    }
    if (parsed.data.appStoreUrl !== undefined) {
      patch.appStoreUrl = parsed.data.appStoreUrl ?? null;
    }

    const [updated] = await db
      .update(appConfigTable)
      .set(patch)
      .where(eq(appConfigTable.id, GLOBAL_ID))
      .returning();

    logger.info(
      {
        admin: admin.email,
        patch: {
          minSupportedVersion: patch.minSupportedVersion,
          latestVersion: patch.latestVersion,
          outageMessageSet: patch.outageMessage !== undefined,
          appStoreUrlSet: patch.appStoreUrl !== undefined,
        },
      },
      "app_config_updated",
    );

    res.json(updated);
  },
);

export default router;
