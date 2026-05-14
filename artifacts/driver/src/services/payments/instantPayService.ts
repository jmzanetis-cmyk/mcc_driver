import { supabase } from '@/services/supabase/client';
import type { DriverRow, PayoutRow } from '@/services/supabase/types';

export interface InstantPayBalance {
  available: number;
  pending: number;
  lastPayoutAt?: string;
  instantPayEnabled: boolean;
  hasDebitCard: boolean;
  isPartnerDriver: boolean;
  dailyCashOutCount: number;
  dailyLimit: number;
}

export interface PayoutResult {
  success: boolean;
  amount?: number;
  fee?: number;
  netAmount?: number;
  arrivalTime?: string;
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

export const INSTANT_PAY_FEE = 0.50;
export const MINIMUM_CASHOUT = 5.00;
export const MAX_DAILY_CASHOUTS = 5;
export const STANDARD_PAYOUT_DAY = 'wednesday';

export async function getInstantPayBalance(driverId: string): Promise<InstantPayBalance> {
  const { data: driverData } = await supabase
    .from('drivers')
    .select('partner_id, stripe_account_id')
    .eq('id', driverId)
    .single();

  if (!driverData) throw new Error('Driver not found');
  const driver = driverData as unknown as Pick<DriverRow, 'partner_id' | 'stripe_account_id'>;

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

  const { data: unpaidRides } = await supabase
    .from('driver_assignments')
    .select('driver_payout_amount, status, completed_at')
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .eq('payout_status', 'unpaid');

  const { data: pendingRides } = await supabase
    .from('driver_assignments')
    .select('driver_payout_amount, status')
    .eq('driver_id', driverId)
    .in('status', ['accepted', 'en_route', 'arrived', 'in_progress']);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: todayCashouts } = await supabase
    .from('driver_payouts')
    .select('id')
    .eq('driver_id', driverId)
    .eq('method', 'instant')
    .gte('created_at', todayStart.toISOString());

  const { data: lastPayoutData } = await supabase
    .from('driver_payouts')
    .select('completed_at')
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1);

  const lastPayout = (lastPayoutData ?? []) as unknown as Array<Pick<PayoutRow, 'completed_at'>>;

  interface PartialAssignment { driver_payout_amount: number | null }
  const available = (unpaidRides ?? []).reduce(
    (sum, r) => sum + ((r as unknown as PartialAssignment).driver_payout_amount ?? 0), 0
  );
  const pending = (pendingRides ?? []).reduce(
    (sum, r) => sum + ((r as unknown as PartialAssignment).driver_payout_amount ?? 0), 0
  );

  const instantPayEnabled = !!driver.stripe_account_id;
  const hasDebitCard = !!driver.stripe_account_id;

  return {
    available: Math.round(available * 100) / 100,
    pending: Math.round(pending * 100) / 100,
    lastPayoutAt: lastPayout[0]?.completed_at ?? undefined,
    instantPayEnabled,
    hasDebitCard,
    isPartnerDriver: false,
    dailyCashOutCount: todayCashouts?.length ?? 0,
    dailyLimit: MAX_DAILY_CASHOUTS,
  };
}

export async function executeInstantPayout(
  driverId: string,
  requestedAmount?: number
): Promise<PayoutResult> {
  const balance = await getInstantPayBalance(driverId);

  if (balance.isPartnerDriver) {
    return {
      success: false,
      error: 'Instant Pay is not available for partner drivers. Your payouts are managed by your partner company.',
      errorCode: 'PARTNER_DRIVER',
    };
  }

  if (!balance.instantPayEnabled) {
    return { success: false, error: 'Set up your Stripe account to enable Instant Pay.', errorCode: 'NO_STRIPE' };
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

  const payoutId = crypto.randomUUID();

  const { error: dbError } = await supabase.from('driver_payouts').insert({
    id: payoutId,
    driver_id: driverId,
    amount: cashOutAmount,
    net_payout: netAmount,
    platform_fee: fee,
    method: 'instant',
    status: 'processing',
    requested_at: new Date().toISOString(),
  });

  if (dbError) {
    return { success: false, error: 'Failed to process payout. Please try again.', errorCode: 'DB_ERROR' };
  }

  await supabase
    .from('driver_assignments')
    .update({ payout_status: 'paid', payout_id: payoutId })
    .eq('driver_id', driverId)
    .eq('status', 'completed')
    .eq('payout_status', 'unpaid');

  return { success: true, amount: cashOutAmount, fee, netAmount, arrivalTime: 'Within minutes', payoutId };
}

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
    net_payout: balance.available,
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

export async function getPayoutHistory(driverId: string, limit = 20): Promise<PayoutHistoryItem[]> {
  const { data } = await supabase
    .from('driver_payouts')
    .select('*')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as unknown as PayoutRow[];
  return rows.map((p) => ({
    id: p.id,
    amount: p.amount ?? 0,
    fee: p.platform_fee ?? 0,
    netAmount: p.net_payout ?? 0,
    method: p.method,
    status: p.status as PayoutHistoryItem['status'],
    initiatedAt: p.requested_at ?? p.created_at,
    arrivalDate: p.completed_at ?? p.scheduled_date ?? undefined,
    cardLast4: p.card_last4 ?? undefined,
    bankLast4: p.bank_last4 ?? undefined,
    failureReason: p.failed_reason ?? undefined,
  }));
}

function getNextPayoutDate(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilWednesday = (3 - dayOfWeek + 7) % 7 || 7;
  const nextWed = new Date(now.getTime() + daysUntilWednesday * 86400000);
  return nextWed.toISOString().split('T')[0];
}
