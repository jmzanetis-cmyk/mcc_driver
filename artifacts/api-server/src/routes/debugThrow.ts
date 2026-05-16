import { Router, type IRouter } from "express";
import { isSentryEnabled } from "../lib/sentry";

const router: IRouter = Router();

// GET /api/_debug/throw — smoke test for Sentry wiring.
// Open in non-production environments (NODE_ENV !== "production")
// OR when DISPATCH_API_KEY is configured and the caller supplies a
// matching `x-api-key` header. Mirrors the lock-down pattern used by
// /api/dev/push-test (documented in replit.md "Ops").
router.get("/_debug/throw", (req, res, next) => {
  const isProd = process.env["NODE_ENV"] === "production";
  const dispatchKey = process.env["DISPATCH_API_KEY"];
  if (isProd) {
    if (!dispatchKey) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (req.header("x-api-key") !== dispatchKey) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }
  const mode = String(req.query["mode"] ?? "sync");
  if (mode === "async") {
    Promise.reject(new Error("debug_throw_async")).catch(next);
    return;
  }
  res.setHeader("x-sentry-enabled", isSentryEnabled() ? "1" : "0");
  throw new Error("debug_throw_sync");
});

export default router;
