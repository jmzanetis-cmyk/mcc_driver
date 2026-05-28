// ============================================================
// MCC API — POST /api/drivers/profile
// Update driver bio and profile photo URL.
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";

const router = Router();

router.post("/drivers/profile", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" }); return;
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) { res.status(401).json({ error: "Invalid token" }); return; }

    const { bio, profilePhotoUrl } = req.body as { bio?: unknown; profilePhotoUrl?: unknown };
    const update: Record<string, unknown> = {};
    if (typeof bio === "string") update.bio = bio.trim().slice(0, 500);
    if (typeof profilePhotoUrl === "string") update.profile_photo_url = profilePhotoUrl;

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: "No valid fields to update" }); return;
    }

    const { error } = await supabaseAdmin
      .from("drivers")
      .update(update)
      .eq("profile_id", user.id);

    if (error) {
      logger.error({ err: error }, "driverProfile.update failed");
      res.status(500).json({ error: "Failed to update profile" }); return;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err }, "driverProfile unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
