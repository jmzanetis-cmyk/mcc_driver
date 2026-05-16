// ============================================================
// MCC API — Stripe Connect Router
// ============================================================
// Handles Stripe Connect Express account creation and onboarding
// links so drivers can connect their bank / debit card to
// receive ride payouts.
// ============================================================

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@workspace/db";
import { driversTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";
import { setSentryRequestIdentity } from "../lib/sentry";

const router: IRouter = Router();

// ── Stripe client factory ──────────────────────────────────────────────────────

function getStripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    logger.warn("STRIPE_SECRET_KEY not configured — Stripe Connect unavailable");
    return null;
  }
  return new Stripe(secretKey);
}

// ── Auth helpers (same pattern as rides/admin routers) ────────────────────────

interface SupabaseUser {
  id: string;
  email?: string;
}

async function verifySupabaseToken(token: string): Promise<SupabaseUser | null> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    logger.warn("Supabase env vars not configured — cannot verify JWT");
    return null;
  }

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
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

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

async function requireUserAuth(req: Request, res: Response): Promise<SupabaseUser | null> {
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
  return user;
}

// ── POST /stripe/connect/onboard ──────────────────────────────────────────────
// Creates (or retrieves) a Stripe Connect Express account for the authenticated
// driver, then returns a one-time account link URL for the onboarding flow.
// The client opens this URL in a new tab / system browser.

router.post("/stripe/connect/onboard", async (req: Request, res: Response) => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const stripe = getStripeClient();
  if (!stripe) {
    res.status(503).json({
      error: "Stripe is not configured on this server. Ask your administrator to add the STRIPE_SECRET_KEY.",
    });
    return;
  }

  const [driver] = await db
    .select({
      id: driversTable.id,
      email: driversTable.email,
      firstName: driversTable.firstName,
      lastName: driversTable.lastName,
      stripeAccountId: driversTable.stripeAccountId,
    })
    .from(driversTable)
    .where(eq(driversTable.userId, user.id))
    .limit(1);

  if (!driver) {
    res.status(404).json({ error: "Driver record not found" });
    return;
  }

  // Derive the base URL to build return / refresh URLs for the account link.
  // Prefer the explicit DRIVER_APP_URL env var; fall back to the first domain
  // published on this Repl; otherwise use whatever the client sent as Host.
  const domains = process.env.REPLIT_DOMAINS?.split(",").map((d) => d.trim()).filter(Boolean) ?? [];
  const baseHost = process.env.DRIVER_APP_URL
    ?? (domains.length > 0 ? `https://${domains[0]}` : `https://${req.headers.host ?? "localhost"}`);

  const returnUrl = `${baseHost}/driver/settings/payments?stripe_return=1`;
  const refreshUrl = `${baseHost}/driver/settings/payments?stripe_refresh=1`;

  try {
    // Reuse existing Connect account when already created.
    let accountId = driver.stripeAccountId ?? null;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: driver.email,
        individual: {
          first_name: driver.firstName,
          last_name: driver.lastName,
        },
        metadata: {
          driver_id: driver.id,
          user_id: user.id,
        },
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
      });

      accountId = account.id;

      await db
        .update(driversTable)
        .set({ stripeAccountId: accountId })
        .where(eq(driversTable.id, driver.id));

      logger.info({ driverId: driver.id, accountId }, "stripe.connect.account_created");
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      return_url: returnUrl,
      refresh_url: refreshUrl,
      type: "account_onboarding",
      collect: "eventually_due",
    });

    logger.info({ driverId: driver.id }, "stripe.connect.link_created");

    res.json({
      url: accountLink.url,
      accountId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe error";
    logger.error({ driverId: driver.id, error: message }, "stripe.connect.onboard_error");
    res.status(500).json({ error: message });
  }
});

// ── GET /stripe/connect/status ─────────────────────────────────────────────────
// Returns the current Stripe Connect account status for the authenticated driver.
// Called when the driver returns from Stripe onboarding to check completion.

router.get("/stripe/connect/status", async (req: Request, res: Response) => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const stripe = getStripeClient();
  if (!stripe) {
    res.status(503).json({
      error: "Stripe is not configured on this server.",
    });
    return;
  }

  const [driver] = await db
    .select({
      id: driversTable.id,
      stripeAccountId: driversTable.stripeAccountId,
    })
    .from(driversTable)
    .where(eq(driversTable.userId, user.id))
    .limit(1);

  if (!driver) {
    res.status(404).json({ error: "Driver record not found" });
    return;
  }

  if (!driver.stripeAccountId) {
    res.json({
      accountId: null,
      onboardingComplete: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      hasDebitCard: false,
    });
    return;
  }

  try {
    const account = await stripe.accounts.retrieve(driver.stripeAccountId);

    const onboardingComplete =
      account.details_submitted === true &&
      (account.charges_enabled === true || account.payouts_enabled === true);

    // Check if the account has any external debit card attached.
    let hasDebitCard = false;
    if (account.external_accounts) {
      const cards = account.external_accounts.data.filter(
        (ea) => ea.object === "card"
      );
      hasDebitCard = cards.length > 0;
    }

    logger.info(
      { driverId: driver.id, onboardingComplete, payoutsEnabled: account.payouts_enabled },
      "stripe.connect.status_checked",
    );

    res.json({
      accountId: driver.stripeAccountId,
      onboardingComplete,
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      hasDebitCard,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe error";
    logger.error({ driverId: driver.id, error: message }, "stripe.connect.status_error");
    res.status(500).json({ error: message });
  }
});

// ── POST /stripe/connect/refresh ───────────────────────────────────────────────
// Generates a fresh account link when the previous one has expired.
// Called when Stripe redirects the driver to the refresh_url.

router.post("/stripe/connect/refresh", async (req: Request, res: Response) => {
  const user = await requireUserAuth(req, res);
  if (!user) return;

  const stripe = getStripeClient();
  if (!stripe) {
    res.status(503).json({ error: "Stripe is not configured on this server." });
    return;
  }

  const [driver] = await db
    .select({ id: driversTable.id, stripeAccountId: driversTable.stripeAccountId })
    .from(driversTable)
    .where(eq(driversTable.userId, user.id))
    .limit(1);

  if (!driver || !driver.stripeAccountId) {
    res.status(404).json({ error: "No Stripe account found. Start onboarding first." });
    return;
  }

  const domains = process.env.REPLIT_DOMAINS?.split(",").map((d) => d.trim()).filter(Boolean) ?? [];
  const baseHost = process.env.DRIVER_APP_URL
    ?? (domains.length > 0 ? `https://${domains[0]}` : `https://${req.headers.host ?? "localhost"}`);

  const returnUrl = `${baseHost}/driver/settings/payments?stripe_return=1`;
  const refreshUrl = `${baseHost}/driver/settings/payments?stripe_refresh=1`;

  try {
    const accountLink = await stripe.accountLinks.create({
      account: driver.stripeAccountId,
      return_url: returnUrl,
      refresh_url: refreshUrl,
      type: "account_onboarding",
      collect: "eventually_due",
    });

    logger.info({ driverId: driver.id }, "stripe.connect.link_refreshed");

    res.json({ url: accountLink.url, accountId: driver.stripeAccountId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stripe error";
    logger.error({ driverId: driver.id, error: message }, "stripe.connect.refresh_error");
    res.status(500).json({ error: message });
  }
});

export default router;
