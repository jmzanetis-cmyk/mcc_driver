// ============================================================
// MCC API — GET /api/drivers/me/referral
// ============================================================
// Returns the driver's referral code and pre-built signup URLs.
// Lazily generates a unique code on first call.
// ============================================================

import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { driversTable } from "@workspace/db/schema";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

const BASE_URL = process.env.MCC_SITE_URL ?? "https://www.mycarconcierge.com";

async function generateUniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = randomBytes(3).toString("hex").toUpperCase(); // 6 hex chars
    const [existing] = await db
      .select({ id: driversTable.id })
      .from(driversTable)
      .where(eq(driversTable.referralCode, code))
      .limit(1);
    if (!existing) return code;
  }
  // Fallback: 8-char code on collision exhaustion
  return randomBytes(4).toString("hex").toUpperCase();
}

router.get("/drivers/me/referral", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    const [driver] = await db
      .select({ id: driversTable.id, referralCode: driversTable.referralCode })
      .from(driversTable)
      .where(eq(driversTable.userId, user.id))
      .limit(1);

    if (!driver) {
      res.status(404).json({ error: "Driver not found" });
      return;
    }

    let code = driver.referralCode;
    if (!code) {
      code = await generateUniqueCode();
      await db
        .update(driversTable)
        .set({ referralCode: code })
        .where(eq(driversTable.id, driver.id));
    }

    res.json({
      referralCode: code,
      providerSignupUrl: `${BASE_URL}/signup-provider?ref=${code}`,
      driverSignupUrl:   `${BASE_URL}/signup-driver?ref=${code}`,
    });
  } catch (err) {
    logger.error({ err }, "referral.get unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
