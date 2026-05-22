// ============================================================
// MCC API — Stripe Webhook Handler
// ============================================================
// Mounted in app.ts with express.raw() BEFORE express.json()
// so Stripe's signature verification gets the unparsed buffer.
//
// Matching strategy:
//   transfer.created  → looks up driver_payouts by stripe_transfer_id
//   payout.*          → looks up driver_payouts.id via metadata.mcc_payout_id
//
// Both metadata keys are written by the payout execution routes
// (payouts.ts / instantPayService). Until those routes are updated
// to call Stripe, these handlers will receive events but find no
// matching DB row and skip gracefully.
// ============================================================

import type { Request, Response } from "express";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { driverPayoutsTable } from "@workspace/db/schema";
import { logger } from "../lib/logger";

function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

export async function stripeWebhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const stripe = getStripeClient();
  if (!stripe) {
    res.status(503).json({ error: "Stripe not configured" });
    return;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error("STRIPE_WEBHOOK_SECRET is not set — webhook endpoint disabled");
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  let event: Stripe.Event;
  try {
    // req.body is a Buffer here (express.raw applied in app.ts before express.json)
    event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      sig,
      webhookSecret,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid signature";
    logger.warn({ error: msg }, "stripe.webhook.signature_invalid");
    res.status(400).json({ error: `Webhook signature verification failed: ${msg}` });
    return;
  }

  logger.info(
    { eventType: event.type, eventId: event.id },
    "stripe.webhook.received",
  );

  try {
    await dispatch(event);
    res.json({ received: true });
  } catch (err) {
    logger.error(
      { err, eventType: event.type, eventId: event.id },
      "stripe.webhook.handler_error",
    );
    // Return 500 so Stripe retries delivery
    res.status(500).json({ error: "Handler error" });
  }
}

// ── Event dispatcher ──────────────────────────────────────────────────────────

async function dispatch(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "transfer.created":
      await onTransferCreated(event.data.object as Stripe.Transfer);
      break;
    case "payout.paid":
      await onPayoutPaid(event.data.object as Stripe.Payout);
      break;
    case "payout.failed":
      await onPayoutFailed(event.data.object as Stripe.Payout);
      break;
    case "payout.canceled":
      await onPayoutCanceled(event.data.object as Stripe.Payout);
      break;
    case "account.updated":
      onAccountUpdated(event.data.object as Stripe.Account);
      break;
    default:
      logger.info({ eventType: event.type }, "stripe.webhook.unhandled_event");
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function onTransferCreated(transfer: Stripe.Transfer): Promise<void> {
  const [row] = await db
    .update(driverPayoutsTable)
    .set({ status: "in_transit" })
    .where(eq(driverPayoutsTable.stripeTransferId, transfer.id))
    .returning({ id: driverPayoutsTable.id });

  if (row) {
    logger.info(
      { payoutId: row.id, transferId: transfer.id },
      "stripe.webhook.transfer_created",
    );
  } else {
    logger.info(
      { transferId: transfer.id },
      "stripe.webhook.transfer_created.no_match",
    );
  }
}

async function onPayoutPaid(payout: Stripe.Payout): Promise<void> {
  const payoutId = payout.metadata?.mcc_payout_id;
  if (!payoutId) {
    logger.info(
      { stripePayoutId: payout.id },
      "stripe.webhook.payout_paid.no_mcc_id",
    );
    return;
  }

  await db
    .update(driverPayoutsTable)
    .set({
      status: "paid",
      completedAt: payout.arrival_date
        ? new Date(payout.arrival_date * 1000)
        : new Date(),
    })
    .where(eq(driverPayoutsTable.id, payoutId));

  logger.info(
    { payoutId, stripePayoutId: payout.id },
    "stripe.webhook.payout_paid",
  );
}

async function onPayoutFailed(payout: Stripe.Payout): Promise<void> {
  const payoutId = payout.metadata?.mcc_payout_id;
  if (!payoutId) {
    logger.info(
      { stripePayoutId: payout.id },
      "stripe.webhook.payout_failed.no_mcc_id",
    );
    return;
  }

  await db
    .update(driverPayoutsTable)
    .set({
      status: "failed",
      failedReason: payout.failure_message ?? "Unknown failure",
    })
    .where(eq(driverPayoutsTable.id, payoutId));

  logger.info(
    { payoutId, stripePayoutId: payout.id, reason: payout.failure_message },
    "stripe.webhook.payout_failed",
  );
}

async function onPayoutCanceled(payout: Stripe.Payout): Promise<void> {
  const payoutId = payout.metadata?.mcc_payout_id;
  if (!payoutId) {
    logger.info(
      { stripePayoutId: payout.id },
      "stripe.webhook.payout_canceled.no_mcc_id",
    );
    return;
  }

  await db
    .update(driverPayoutsTable)
    .set({ status: "canceled" })
    .where(eq(driverPayoutsTable.id, payoutId));

  logger.info(
    { payoutId, stripePayoutId: payout.id },
    "stripe.webhook.payout_canceled",
  );
}

function onAccountUpdated(account: Stripe.Account): void {
  logger.info(
    {
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    },
    "stripe.webhook.account_updated",
  );
}
