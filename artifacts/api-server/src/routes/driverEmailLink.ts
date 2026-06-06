// ============================================================
// MCC API — POST /api/drivers/link-email
// Binds an email address to the caller's existing auth.users row
// using the service-role admin API, bypassing client-side
// confirmation (which is broken for phone-first accounts).
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

router.post("/drivers/link-email", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" }); return;
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) { res.status(401).json({ error: "Invalid token" }); return; }

    const { email } = req.body as { email?: unknown };
    if (typeof email !== "string" || !email.includes("@") || !email.includes(".")) {
      res.status(400).json({ error: "A valid email address is required" }); return;
    }
    const normalized = email.trim().toLowerCase();

    if (user.email?.toLowerCase() === normalized) {
      res.status(200).json({ success: true }); return;
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      email: normalized,
      email_confirm: true,
    });

    if (error) {
      logger.error({ err: error, userId: user.id }, "driverEmailLink: admin updateUserById failed");
      res.status(400).json({ error: error.message }); return;
    }

    logger.info({ userId: user.id }, "driverEmailLink: email linked via admin API");
    res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err }, "driverEmailLink unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
