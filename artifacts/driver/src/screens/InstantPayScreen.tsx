// ============================================================
// MCC Driver — Instant Pay Screen
// ============================================================
// Cash out earnings instantly to a debit card, or schedule
// a free standard payout. Shows balance, history, and status.
// ============================================================

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useInstantPay } from '@/hooks/useInstantPay';
import { INSTANT_PAY_FEE, MINIMUM_CASHOUT, MAX_DAILY_CASHOUTS } from '@/services/payments/instantPayService';
import { PageHeader, Card, Button, Spinner, InfoRow } from '@/components';
import { OfflineNotice, isOffline } from '@/components/OfflineNotice';
import { colors, borderRadius, withAlpha } from '@/theme';
import { formatCurrency, formatDate, formatTime } from '@/utils/formatters';

export function InstantPayScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const {
    balance, history, isLoading, isProcessing, lastResult,
    cashOutInstant, cashOutStandard, clearResult,
  } = useInstantPay(driver?.id || null);

  const [showConfirm, setShowConfirm] = useState<'instant' | 'standard' | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [useCustomAmount, setUseCustomAmount] = useState(false);

  if (!driver || isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner size={32} color={colors.navy} />
      </div>
    );
  }

  if (!balance) return null;

  // Partner driver gate
  if (balance.isPartnerDriver) {
    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
        <PageHeader title="Instant Pay" onBack={() => navigate('/earnings')} />
        <div style={{ padding: 24, textAlign: 'center', marginTop: 48 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🏢</div>
          <span className="eyebrow" style={{ marginBottom: 8 }}>Partner Driver</span>
          <div className="heading-editorial heading-editorial-md" style={{ marginBottom: 8 }}>
            Managed by Your Partner
          </div>
          <div style={{ fontSize: 14, color: colors.textMuted, maxWidth: 300, margin: '0 auto' }}>
            As a partner driver, your payouts are handled by your transportation partner company. Contact them for payout schedules and details.
          </div>
        </div>
      </div>
    );
  }

  const cashOutValue = useCustomAmount && customAmount
    ? parseFloat(customAmount)
    : balance.available;

  const canCashOutInstant = balance.instantPayEnabled
    && balance.hasDebitCard
    && balance.available >= MINIMUM_CASHOUT
    && balance.dailyCashOutCount < balance.dailyLimit;

  const handleInstantPayout = async () => {
    setShowConfirm(null);
    if (isOffline()) return; // OfflineNotice + global banner show the reason
    const amount = useCustomAmount ? parseFloat(customAmount) : undefined;
    await cashOutInstant(amount);
  };

  const handleStandardPayout = async () => {
    setShowConfirm(null);
    if (isOffline()) return;
    await cashOutStandard();
  };

  const statusColors: Record<string, string> = {
    pending: colors.warning,
    in_transit: colors.info,
    paid: colors.success,
    failed: colors.error,
    canceled: colors.textMuted,
    processing: colors.info,
    scheduled: colors.warning,
    completed: colors.success,
  };

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Instant Pay" subtitle="Cash out your earnings" onBack={() => navigate('/earnings')} />

      <div style={{ padding: 20 }}>
        {/* Success / Error result */}
        {lastResult && (
          <div style={{
            padding: 16, borderRadius: borderRadius.md, marginBottom: 16,
            background: lastResult.success ? colors.successBg : colors.errorBg,
            border: `1px solid ${lastResult.success ? colors.success : colors.error}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: lastResult.success ? colors.success : colors.error }}>
                  {lastResult.success ? '✓ Payout initiated!' : '✗ Payout failed'}
                </div>
                {lastResult.success ? (
                  <>
                    <div style={{ fontSize: 13, color: colors.success, marginTop: 4 }}>
                      {formatCurrency(lastResult.netAmount!)} on its way • {lastResult.arrivalTime}
                    </div>
                    {lastResult.warning && (
                      <div style={{ fontSize: 12, color: colors.warning, marginTop: 4 }}>
                        ⚠️ {lastResult.warning}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 13, color: colors.error, marginTop: 4 }}>
                    {lastResult.error}
                  </div>
                )}
              </div>
              <button
                onClick={clearResult}
                aria-label="Dismiss payout result"
                style={{
                  background: 'none', border: 'none', fontSize: 18, cursor: 'pointer',
                  color: colors.textMuted,
                  minWidth: 44, minHeight: 44,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 8, padding: 0,
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </div>
        )}

        {/* Balance card */}
        <div style={{
          background: colors.surfaceDark, borderRadius: borderRadius.lg,
          padding: 24, marginBottom: 20, textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, color: colors.gold, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Available Balance
          </div>
          <div style={{ fontSize: 44, fontWeight: 700, color: colors.textWhite, margin: '8px 0' }}>
            {formatCurrency(balance.available)}
          </div>
          {balance.pending > 0 && (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
              + {formatCurrency(balance.pending)} pending (in-progress rides)
            </div>
          )}
          {balance.lastPayoutAt && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 8 }}>
              Last cash-out: {formatDate(balance.lastPayoutAt)}
            </div>
          )}
        </div>

        {/* Custom amount toggle */}
        {balance.available >= MINIMUM_CASHOUT && (
          <Card style={{ marginBottom: 16 }} padding={16}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: useCustomAmount ? 12 : 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: colors.textPrimary }}>Cash out a custom amount?</div>
              <button
                onClick={() => { setUseCustomAmount(!useCustomAmount); setCustomAmount(''); }}
                style={{
                  background: useCustomAmount ? colors.gold : colors.bgSecondary,
                  color: useCustomAmount ? colors.navy : colors.textMuted,
                  border: 'none', borderRadius: borderRadius.full,
                  padding: '4px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {useCustomAmount ? 'Full amount' : 'Custom'}
              </button>
            </div>
            {useCustomAmount && (
              <>
                <label htmlFor="instant-pay-custom-amount" style={{
                  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
                  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
                }}>
                  Custom cash-out amount in US dollars
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span aria-hidden="true" style={{ fontSize: 24, fontWeight: 700, color: colors.navy }}>$</span>
                  <input
                    id="instant-pay-custom-amount"
                    type="number"
                    inputMode="decimal"
                    value={customAmount}
                    onChange={e => setCustomAmount(e.target.value)}
                    placeholder={balance.available.toFixed(2)}
                    min={MINIMUM_CASHOUT}
                    max={balance.available}
                    step="0.01"
                    aria-describedby="instant-pay-custom-amount-help"
                    style={{
                      flex: 1, padding: '10px 14px', fontSize: 24, fontWeight: 700,
                      border: `2px solid ${colors.gold}`, borderRadius: borderRadius.md,
                      background: colors.bgPrimary, color: colors.navy,
                      outline: 'none', fontFamily: 'inherit',
                      minHeight: 44,
                    }}
                  />
                </div>
                <div id="instant-pay-custom-amount-help" style={{ fontSize: 11, color: colors.textMuted, marginTop: 8 }}>
                  Payouts are allocated by completed trip — the disbursed amount may be slightly less than entered if trip amounts don't add up exactly.
                </div>
              </>
            )}
          </Card>
        )}

        <OfflineNotice
          message="You're offline — cash out will be blocked until your connection is back."
          style={{ marginBottom: 12 }}
        />

        {/* Instant Pay button */}
        <Button
          onClick={() => setShowConfirm('instant')}
          disabled={!canCashOutInstant || isProcessing}
          loading={isProcessing}
          fullWidth
          size="lg"
          style={{ marginBottom: 8 }}
        >
          ⚡ Instant Pay — {formatCurrency(cashOutValue - INSTANT_PAY_FEE)}
        </Button>
        <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', marginBottom: 16 }}>
          {formatCurrency(INSTANT_PAY_FEE)} fee • Arrives in minutes to your debit card
        </div>

        {/* Standard payout button */}
        <Button
          onClick={() => setShowConfirm('standard')}
          variant="secondary"
          disabled={balance.available < MINIMUM_CASHOUT || isProcessing}
          fullWidth
          size="md"
          style={{ marginBottom: 8 }}
        >
          Standard Payout — {formatCurrency(cashOutValue)}
        </Button>
        <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', marginBottom: 24 }}>
          Free • 2-3 business days to your bank account
        </div>

        {/* Status warnings */}
        {!balance.instantPayEnabled && (
          <Card style={{ marginBottom: 12, background: colors.warningBg, border: 'none' }} padding={14}>
            <div style={{ fontSize: 13, color: colors.warning, marginBottom: 8 }}>
              ⚠️ Connect your bank or debit card to enable payouts.
            </div>
            <button
              onClick={() => navigate('/settings/payments')}
              style={{
                width: '100%', padding: '10px 0',
                background: colors.surfaceDark, border: 'none',
                borderRadius: 8, cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: colors.gold,
              }}
            >
              🏦 Set Up Payouts
            </button>
          </Card>
        )}
        {balance.instantPayEnabled && !balance.hasDebitCard && (
          <Card style={{ marginBottom: 12, background: colors.infoBg, border: 'none' }} padding={14}>
            <div style={{ fontSize: 13, color: colors.info }}>
              💳 Add a debit card for instant payouts. Bank accounts only support standard (2-3 day) transfers.
            </div>
          </Card>
        )}
        {balance.dailyCashOutCount >= balance.dailyLimit && (
          <Card style={{ marginBottom: 12, background: colors.warningBg, border: 'none' }} padding={14}>
            <div style={{ fontSize: 13, color: colors.warning }}>
              You've used all {MAX_DAILY_CASHOUTS} instant payouts for today. Try again tomorrow.
            </div>
          </Card>
        )}

        {/* Info card */}
        <Card style={{ marginBottom: 20 }} padding={14}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            How It Works
          </div>
          <InfoRow icon="⚡" label="Instant Pay" value={`${formatCurrency(INSTANT_PAY_FEE)} fee, arrives in minutes`} />
          <InfoRow icon="🏦" label="Standard" value="Free, 2-3 business days" />
          <InfoRow icon="📊" label="Minimum" value={formatCurrency(MINIMUM_CASHOUT)} />
          <InfoRow icon="🔄" label="Daily limit" value={`${MAX_DAILY_CASHOUTS} instant payouts`} />
          <InfoRow icon="📅" label="Auto payout" value="Every Wednesday (free)" />
          <InfoRow icon="💰" label="Tips" value="100% yours, always" />
        </Card>

        {/* Payout history */}
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          Payout History
        </div>

        {history.length === 0 ? (
          <Card padding={24}>
            <div style={{ textAlign: 'center', color: colors.textMuted }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>💳</div>
              <div style={{ fontSize: 14 }}>No payouts yet</div>
            </div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map(payout => (
              <Card key={payout.id} padding={14}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>
                      {payout.method === 'instant' ? '⚡ Instant Pay' : '🏦 Standard'}
                    </div>
                    <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                      {formatDate(payout.initiatedAt)} at {formatTime(payout.initiatedAt)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: colors.navy }}>
                      {formatCurrency(payout.netAmount)}
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 6px',
                      borderRadius: borderRadius.full,
                      color: statusColors[payout.status] || colors.textMuted,
                      background: withAlpha(statusColors[payout.status] || colors.textMuted, '15'),
                    }}>
                      {payout.status.toUpperCase()}
                    </span>
                  </div>
                </div>
                {payout.fee > 0 && (
                  <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
                    {formatCurrency(payout.amount)} − {formatCurrency(payout.fee)} fee = {formatCurrency(payout.netAmount)}
                  </div>
                )}
                {payout.failureReason && (
                  <div style={{ fontSize: 11, color: colors.error, marginTop: 4 }}>
                    {payout.failureReason}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}

        <div style={{ height: 32 }} />
      </div>

      {/* Confirmation modal */}
      {showConfirm && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: colors.bgOverlay,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}>
          <Card style={{ maxWidth: 360, width: '100%' }} padding={24}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>
                {showConfirm === 'instant' ? '⚡' : '🏦'}
              </div>
              <div className="heading-editorial heading-editorial-lg">
                {showConfirm === 'instant' ? 'Instant Pay' : 'Standard Payout'}
              </div>
            </div>

            <div style={{
              background: colors.bgSecondary, borderRadius: borderRadius.md,
              padding: 16, marginBottom: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 14, color: colors.textMuted }}>Amount</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{formatCurrency(cashOutValue)}</span>
              </div>
              {showConfirm === 'instant' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 14, color: colors.textMuted }}>Fee</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: colors.error }}>−{formatCurrency(INSTANT_PAY_FEE)}</span>
                </div>
              )}
              <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: colors.navy }}>You'll receive</span>
                <span className="heading-editorial heading-editorial-md">
                  {formatCurrency(showConfirm === 'instant' ? cashOutValue - INSTANT_PAY_FEE : cashOutValue)}
                </span>
              </div>
            </div>

            <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', marginBottom: 20 }}>
              {showConfirm === 'instant'
                ? 'Funds will arrive in your debit card within minutes.'
                : 'Funds will arrive in your bank account within 2-3 business days.'}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <Button onClick={() => setShowConfirm(null)} variant="secondary" style={{ flex: 1 }}>
                Cancel
              </Button>
              <Button
                onClick={showConfirm === 'instant' ? handleInstantPayout : handleStandardPayout}
                loading={isProcessing}
                style={{ flex: 1 }}
              >
                Confirm
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
