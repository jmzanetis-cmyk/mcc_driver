import Stripe from "stripe";
import { logger } from "./logger";

export interface DriverPayoutCapabilities {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  hasDebitCard: boolean;
  hasBank: boolean;
}

function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

export async function getDriverPayoutCapabilities(
  stripeAccountId: string,
): Promise<DriverPayoutCapabilities> {
  const stripe = getStripeClient();
  if (!stripe) {
    logger.warn("STRIPE_SECRET_KEY not set — returning empty capabilities");
    return {
      chargesEnabled: false,
      payoutsEnabled: false,
      hasDebitCard: false,
      hasBank: false,
    };
  }

  const account = await stripe.accounts.retrieve(stripeAccountId);
  const external = account.external_accounts?.data ?? [];

  return {
    chargesEnabled: account.charges_enabled ?? false,
    payoutsEnabled: account.payouts_enabled ?? false,
    hasDebitCard: external.some((ea) => ea.object === "card"),
    hasBank: external.some((ea) => ea.object === "bank_account"),
  };
}

export async function canDriverInstantPayout(
  stripeAccountId: string,
): Promise<boolean> {
  const caps = await getDriverPayoutCapabilities(stripeAccountId);
  return caps.payoutsEnabled && caps.hasDebitCard;
}
