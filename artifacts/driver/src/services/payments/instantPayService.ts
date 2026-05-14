// ============================================================
// MCC Driver — Instant Pay Service
// ============================================================
// Enables drivers to cash out available earnings immediately
// via Stripe Connect Instant Payouts (to debit card).
//
// How it works:
// 1. Driver completes rides → earnings accrue in their
//    Stripe Connect balance
// 2. Driver taps "Instant Pay" → we call Stripe to create
//    an instant payout to their linked debit card
// 3. Funds arrive in minutes (not days)
//
// Fees:
// - Standard weekly payout: FREE (ACH, 2-3 business days)
// - Instant Pay: $0.50 flat fee per cash-out (MCC keeps this)
// - Minimum cash-out: $5.00
// - Maximum: whatever's in their balance
//
// Requirements:
// - Independent drivers only (partner drivers are paid by partner)
// - Must have a debit card linked (not bank account — instant
//   payouts only work to debit cards)
// - Stripe Connect Express account in good standing
// ============================================================

import { supabase } from '@/services/supabase/client';

// ============================================================
// TYPES
// ============================================================

export interface InstantPayBalance {
  available: number;          // What they can cash out right now
  pending: number;            // Earnings not yet available (in-transit rides, holds)
  lastPayoutAt?: string;      // When they last cashed out
  instantPayEnabled: boolean; // Whether their Stripe account supports instant
  hasDebitCard: boolean;      // Whether they have a debit card linked
  isPartnerDriver: boolean;   // Partner drivers can't use instant pay
  dailyCashOutCount: number;  // How many times they've cashed out today
  dailyLimit: number;         // Max cash-outs per day
}

export interface PayoutResult {
  success: boolean;
  amount?: number;
  fee?: number;
  netAmount?: number;
  arrivalTime?: string;       // "Within minutes" or specific ETA
  payoutId?: string;
  error?: string;
  errorCode?: string;
}

export interface PayoutHistoryItem {
  id: string;
  amount: number;
  fee: number;
  netAmount: number;
  method: 'instant' | 'standard';
  status: 'pending' | 'in_transit' | 'paid' | 'failed' | 'canceled';
  initiatedAt: string;
  arrivalDate?: string;
  cardLast4?: string;
  bankLast4?: string;
  failureReason?: string;
}

// ============================================================
// CONSTANTS
// ============================================================

export const INSTANT_PAY_FEE = 0.50;      // $0.50 per instant payout
export const MINIMUM_CASHOUT = 5.00;       // $5 minimum
export const MAX_DAILY_CASHOUTS = 5;       // Max 5 instant payouts per day
export const STANDARD_PAYOUT_DAY = 'wednesday'; // Weekly ACH on Wednesdays

// ============================================================
// BALANCE CHECK
// ============================================================

/**
 * Get the driver's current available balance and instant pay status.
 * In production, this calls the Stripe API to get the real balance.
 * For now, we aggregate from completed rides in Supabase.
 */
export async function getInstantPayBalance(driverId: string): Promise<InstantPayBalance> {
  // Check if partner driver
  const { data: driver } = await supabase
    .from('drivers')
    .select('partner_id, stripe_account_id')
    .eq('id', driverId)
    .single() as any;

  if (!driver) throw new Error('Driver not found');

  const isPartnerDriver = !!driver.partner_id;

  if (isPartnerDriver) {
    return {
      available: 0,
      pending: 0,
      instantPayEnabled: false,
      hasDebitCard: false,
      isPartnerDriver: true,
      dailyCashOutCount: 0,
      dailyLimit: 0,
    };
  }

  if (!driver.stripe_account_id) {
    return {
      available: 0,
      pending: 0,
      instantPayEnabled: false,
      hasDebitCard: false,
      isPartnerDriver: false,
      dailyCashOutCount: 0,
      dailyLimit: MAX_DAILY_CASHOUTS,
    };
  }

  // Get completed ride earnings not yet paid out
  const { data: unpaidRides } = await supabase
    .from('driver_assignments')
    .select('driver_payout_amount, status, completed_at')
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .eq('payout_status', 'unpaid');

  // Get in-progress ride earnings (pending)
  const { data: pendingRides } = await supabase
    .from('driver_assignments')
    .select('driver_payout_amount, status')
    .eq('driver_id', driverId)
    .in('status', ['accepted', 'en_route', 'arrived', 'in_progress']);

  // Get today's cashout count
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: todayCashouts } = await supabase
    .from('driver_payouts')
    .select('id')
    .eq('driver_id', driverId)
    .eq('method', 'instant')
    .gte('created_at', todayStart.toISOString());

  // Get last payout
  const { data: lastPayout } = await supabase
    .from('driver_payouts')
    .select('completed_at')
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1) as any;

  // Sum up available balance
  const available = (unpaidRides || []).reduce(
    (sum, r) => sum + (r.driver_payout_amount || 0), 0
  );

  const pending = (pendingRides || []).reduce(
    (sum, r) => sum + (r.driver_payout_amount || 0), 0
  );

  // In production: check Stripe for instant payout capability and debit card
  // For now, assume enabled if they have a Stripe account
  const instantPayEnabled = !!driver.stripe_account_id;
  const hasDebitCard = !!driver.stripe_account_id; // Placeholder

  return {
    available: Math.round(available * 100) / 100,
    pending: Math.round(pending * 100) / 100,
    lastPayoutAt: lastPayout?.[0]?.completed_at,
    instantPayEnabled,
    hasDebitCard,
    isPartnerDriver: false,
    dailyCashOutCount: todayCashouts?.length || 0,
    dailyLimit: MAX_DAILY_CASHOUTS,
  };
}

// ============================================================
// INSTANT PAYOUT
// ============================================================

/**
 * Execute an instant payout.
 *
 * In production, this:
 * 1. Calls Stripe API: POST /v1/payouts with method=instant
 *    on the connected account
 * 2. Stripe moves funds from the connected account balance
 *    to the driver's linked debit card
 * 3. Funds arrive within 30 minutes (usually < 10 min)
 *
 * The $0.50 fee is deducted from the payout amount.
 */
export async function executeInstantPayout(
  driverId: string,
  requestedAmount?: number  // If null, cash out everything
): Promise<PayoutResult> {
  // Get current balance
  const balance = await getInstantPayBalance(driverId);

  // Validations
  if (balance.isPartnerDriver) {
    return {
      success: false,
      error: 'Instant Pay is not available for partner drivers. Your payouts are managed by your partner company.',
      errorCode: 'PARTNER_DRIVER',
    };
  }

  if (!balance.instantPayEnabled) {
    return {
      success: false,
      error: 'Set up your Stripe account to enable Instant Pay.',
      errorCode: 'NO_STRIPE',
    };
  }

  if (!balance.hasDebitCard) {
    return {
      success: false,
      error: 'Add a debit card to your account for instant payouts. Bank accounts only support standard (2-3 day) payouts.',
      errorCode: 'NO_DEBIT_CARD',
    };
  }

  if (balance.dailyCashOutCount >= balance.dailyLimit) {
    return {
      success: false,
      error: `You've reached the daily limit of ${balance.dailyLimit} instant payouts. Try again tomorrow, or wait for your free weekly payout on ${STANDARD_PAYOUT_DAY}.`,
      errorCode: 'DAILY_LIMIT',
    };
  }

  const cashOutAmount = requestedAmount
    ? Math.min(requestedAmount, balance.available)
    : balance.available;

  if (cashOutAmount < MINIMUM_CASHOUT) {
    return {
      success: false,
      error: `Minimum cash-out is $${MINIMUM_CASHOUT.toFixed(2)}. You have $${balance.available.toFixed(2)} available.`,
      errorCode: 'BELOW_MINIMUM',
    };
  }

  const fee = INSTANT_PAY_FEE;
  const netAmount = Math.round((cashOutAmount - fee) * 100) / 100;

  if (netAmount <= 0) {
    return {
      success: false,
      error: `After the $${fee.toFixed(2)} instant pay fee, there wouldn't be anything left to pay out.`,
      errorCode: 'FEE_EXCEEDS_AMOUNT',
    };
  }

  // ── In production: call Stripe API ──
  // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  // const payout = await stripe.payouts.create(
  //   { amount: Math.round(netAmount * 100), currency: 'usd', method: 'instant' },
  //   { stripeAccount: driver.stripe_account_id }
  // );
  // ──────────────────────────────────────

  // Record the payout
  const payoutId = crypto.randomUUID();

  const { error: dbError } = await supabase.from('driver_payouts').insert({
    id: payoutId,
    driver_id: driverId,
    amount: cashOutAmount,
    net_payout: netAmount,
    platform_fee: fee,
    method: 'instant',
    status: 'processing',  // Will be updated by Stripe webhook
    requested_at: new Date().toISOString(),
    // stripe_payout_id: payout.id,  // From Stripe response
  });

  if (dbError) {
    return {
      success: false,
      error: 'Failed to process payout. Please try again.',
      errorCode: 'DB_ERROR',
    };
  }

  // Mark the rides as paid
  await supabase
    .from('driver_assignments')
    .update({ payout_status: 'paid', payout_id: payoutId })
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .eq('payout_status', 'unpaid');

  return {
    success: true,
    amount: cashOutAmount,
    fee,
    netAmount,
    arrivalTime: 'Within minutes',
    payoutId,
  };
}

// ============================================================
// STANDARD (FREE) PAYOUT
// ============================================================

/**
 * Schedule a standard ACH payout (free, 2-3 business days).
 * This happens automatically on the weekly schedule, but
 * drivers can also trigger it manually.
 */
export async function executeStandardPayout(driverId: string): Promise<PayoutResult> {
  const balance = await getInstantPayBalance(driverId);

  if (balance.isPartnerDriver) {
    return { success: false, error: 'Partner drivers are paid through their partner company.', errorCode: 'PARTNER_DRIVER' };
  }

  if (balance.available < MINIMUM_CASHOUT) {
    return { success: false, error: `Minimum payout is $${MINIMUM_CASHOUT.toFixed(2)}.`, errorCode: 'BELOW_MINIMUM' };
  }

  const payoutId = crypto.randomUUID();

  await supabase.from('driver_payouts').insert({
    id: payoutId,
    driver_id: driverId,
    amount: balance.available,
    net_payout: balance.available,  // No fee for standard
    platform_fee: 0,
    method: 'standard',
    status: 'scheduled',
    scheduled_date: getNextPayoutDate(),
    requested_at: new Date().toISOString(),
  });

  await supabase
    .from('driver_assignments')
    .update({ payout_status: 'paid', payout_id: payoutId })
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .eq('payout_status', 'unpaid');

  return {
    success: true,
    amount: balance.available,
    fee: 0,
    netAmount: balance.available,
    arrivalTime: '2-3 business days',
    payoutId,
  };
}

// ============================================================
// PAYOUT HISTORY
// ============================================================

export async function getPayoutHistory(
  driverId: string,
  limit: number = 20
): Promise<PayoutHistoryItem[]> {
  const { data } = await supabase
    .from('driver_payouts')
    .select('*')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data || []).map((p: any) => ({
    id: p.id,
    amount: p.amount || 0,
    fee: p.platform_fee || 0,
    netAmount: p.net_payout || 0,
    method: p.method || 'standard',
    status: p.status,
    initiatedAt: p.requested_at || p.created_at,
    arrivalDate: p.completed_at || p.scheduled_date,
    cardLast4: p.card_last4,
    bankLast4: p.bank_last4,
    failureReason: p.failed_reason,
  }));
}

// ============================================================
// HELPERS
// ============================================================

function getNextPayoutDate(): string {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 3=Wed
  const daysUntilWednesday = (3 - dayOfWeek + 7) % 7 || 7;
  const nextWed = new Date(now.getTime() + daysUntilWednesday * 86400000);
  return nextWed.toISOString().split('T')[0];
}
