// ============================================================
// MCC API — Dev-only test push route
// ============================================================
// Sends a test native push to a specific driver. Used by the
// scripts/send-test-push.ts smoke test to verify foreground /
// background / killed delivery on a real device.
//
// Protected by the DISPATCH_API_KEY (x-api-key header) when set;
// in dev (no key configured) it's open for convenience. Always
// 503s in production unless DISPATCH_API_KEY is set, matching the
// rides/dispatch gate.

import { Router, type IRouter, type Request, type Response } from "express";
import { sendNativePush } from "../lib/webPush";
import { isApnsConfigured } from "../lib/apnsPush";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function requireDispatchKey(req: Request, res: Response): boolean {
  const dispatchKey = process.env["DISPATCH_API_KEY"];
  if (!dispatchKey) {
    if (process.env["NODE_ENV"] === "production") {
      res.status(503).json({ error: "Push test endpoint not configured" });
      return false;
    }
    return true;
  }
  const provided = req.headers["x-api-key"];
  if (provided !== dispatchKey) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

router.post("/dev/push-test", async (req: Request, res: Response) => {
  if (!requireDispatchKey(req, res)) return;

  const body = req.body as {
    audienceKind?: "driver" | "ride_along_driver";
    audienceId?: string;
    title?: string;
    message?: string;
    url?: string;
  };
  if (!body.audienceId) {
    res.status(400).json({ error: "audienceId is required" });
    return;
  }
  const kind = body.audienceKind ?? "driver";

  await sendNativePush(
    { kind, id: body.audienceId },
    {
      event: "dev.push_test",
      title: body.title ?? "MCC test push",
      body: body.message ?? "If you can see this, native push is working.",
      url: body.url,
      data: { test: true, sentAt: new Date().toISOString() },
    },
  );

  logger.info(
    { audience: { kind, id: body.audienceId }, apnsConfigured: isApnsConfigured() },
    "dev.push_test.fired",
  );

  res.json({
    ok: true,
    apnsConfigured: isApnsConfigured(),
    note: "Push fan-out is best-effort and async — check server logs and the device.",
  });
});

export default router;
