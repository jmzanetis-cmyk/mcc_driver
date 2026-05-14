// ============================================================
// MCC Driver — useInstantPay Hook
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getInstantPayBalance,
  executeInstantPayout,
  executeStandardPayout,
  getPayoutHistory,
  type InstantPayBalance,
  type PayoutResult,
  type PayoutHistoryItem,
} from '@/services/payments/instantPayService';

export function useInstantPay(driverId: string | null) {
  const queryClient = useQueryClient();
  const [balance, setBalance] = useState<InstantPayBalance | null>(null);
  const [history, setHistory] = useState<PayoutHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<PayoutResult | null>(null);

  const refresh = useCallback(async () => {
    if (!driverId) return;
    setIsLoading(true);

    const [bal, hist] = await Promise.all([
      getInstantPayBalance(driverId),
      getPayoutHistory(driverId),
    ]);

    setBalance(bal);
    setHistory(hist);
    setIsLoading(false);
  }, [driverId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const cashOutInstant = useCallback(async (amount?: number) => {
    if (!driverId) return;
    setIsProcessing(true);
    setLastResult(null);

    const result = await executeInstantPayout(driverId, amount);
    setLastResult(result);
    setIsProcessing(false);

    // Always refresh balance/history and invalidate earnings after any payout
    // attempt that reached the server — success: true covers both clean success
    // and the partial-success (ASSIGNMENT_UPDATE_ERROR) warning case.
    if (result.success) {
      await refresh();
      queryClient.invalidateQueries({ queryKey: ['earnings', driverId] });
    }

    return result;
  }, [driverId, refresh, queryClient]);

  const cashOutStandard = useCallback(async () => {
    if (!driverId) return;
    setIsProcessing(true);
    setLastResult(null);

    const result = await executeStandardPayout(driverId);
    setLastResult(result);
    setIsProcessing(false);

    // Always refresh balance/history and invalidate earnings after any payout
    // attempt that reached the server — success: true covers both clean success
    // and the partial-success (ASSIGNMENT_UPDATE_ERROR) warning case.
    if (result.success) {
      await refresh();
      queryClient.invalidateQueries({ queryKey: ['earnings', driverId] });
    }

    return result;
  }, [driverId, refresh, queryClient]);

  const clearResult = useCallback(() => {
    setLastResult(null);
  }, []);

  return {
    balance,
    history,
    isLoading,
    isProcessing,
    lastResult,
    cashOutInstant,
    cashOutStandard,
    refresh,
    clearResult,
  };
}
