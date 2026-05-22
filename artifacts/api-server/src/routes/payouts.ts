// ============================================================
// MCC API — Payouts Router
// ============================================================
// Exposes POST /api/payouts/run-weekly to trigger the weekly
// auto-payout job for all eligible drivers.
// Protected by DISPATCH_API_KEY so only trusted callers (the
// internal scheduler or an ops script) can invoke it.
// ============================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { runWeeklyPayouts } from "../services/weeklyPayoutService";

const router: IRouter = Router();

// ── Auth helper ───────────────────────────────────────────────────────────────

function requireApiKey(req: Request, res: Response): boolean {
  const configuredKey = process.env.DISPATCH_API_KEY;
  if (!configuredKey) {
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({ error: "Payout service not configured" });
      return false;
    }
    logger.warn("DISPATCH_API_KEY not set — weekly payout endpoint unprotected in dev mode");
    return true;
  }

  const provided = req.headers["x-api-key"];
  if (provided !== configuredKey) {
    res.status(401).json({ error: "Unauthorized — invalid API key" });
    return false;
  }
  return true;
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.post("/payouts/run-weekly", async (req: Request, res: Response) => {
  if (!requireApiKey(req, res)) return;

  try {
    const summary = await runWeeklyPayouts();
    res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    logger.error({ err }, "Weekly payout route: unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
