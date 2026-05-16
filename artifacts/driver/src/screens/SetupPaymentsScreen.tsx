// ============================================================
// MCC Driver — Set Up Payments Screen
// ============================================================
// Guides the driver through Stripe Connect Express onboarding
// so they can receive ride payouts to a bank account or debit card.
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { initiateStripeConnect, getStripeConnectStatus, refreshStripeConnectLink } from '@/services/api/edgeFunctions';
import { PageHeader, Card, Button, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';

type SetupState =
  | 'idle'
  | 'loading_status'
  | 'launching'
  | 'refreshing'
  | 'complete'
  | 'partial'
  | 'error';

interface ConnectStatus {
  accountId: string | null;
  onboardingComplete: boolean;
  payoutsEnabled: boolean;
  hasDebitCard: boolean;
}

export function SetupPaymentsScreen() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { driver, refreshDriver } = useAuth();

  const [state, setState] = useState<SetupState>('loading_status');
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const isReturn = searchParams.get('stripe_return') === '1';
  const isRefreshNeeded = searchParams.get('stripe_refresh') === '1';

  // Track whether we should auto-launch a fresh link once status is known.
  // Using a ref means the auto-refresh intent survives across state transitions
  // (status fetch → partial / idle) without causing extra re-renders.
  const pendingAutoRefresh = useRef(isRefreshNeeded);

  const fetchStatus = useCallback(async () => {
    setState('loading_status');
    const result = await getStripeConnectStatus();
    if (!result.success || !result.data) {
      setState('error');
      setErrorMsg(result.error ?? 'Unable to load payment account status.');
      return;
    }
    const s = result.data;
    setStatus(s);

    if (s.onboardingComplete && s.payoutsEnabled) {
      await refreshDriver();
      setState('complete');
    } else if (s.accountId && !s.onboardingComplete) {
      setState('partial');
    } else {
      setState('idle');
    }
  }, [refreshDriver]);

  // Initial status check on mount.
  useEffect(() => {
    fetchStatus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When Stripe redirects back via refresh_url, automatically generate a fresh
  // link as soon as we know the account exists (state = partial or idle).
  // We consume the flag via the ref so this runs exactly once.
  useEffect(() => {
    if (!pendingAutoRefresh.current) return;
    if (state !== 'partial' && state !== 'idle') return;

    pendingAutoRefresh.current = false;
    let cancelled = false;
    setState('refreshing');
    refreshStripeConnectLink().then((result) => {
      if (cancelled) return;
      if (result.success && result.data?.url) {
        window.open(result.data.url, '_blank', 'noopener,noreferrer');
        setState(state === 'idle' ? 'idle' : 'partial');
      } else {
        setState('error');
        setErrorMsg(result.error ?? 'Failed to refresh setup link.');
      }
    });
    return () => { cancelled = true; };
  }, [state]);

  const handleStartOnboarding = async () => {
    setState('launching');
    const result = await initiateStripeConnect();
    if (!result.success || !result.data?.url) {
      setState('error');
      setErrorMsg(result.error ?? 'Failed to start payment account setup.');
      return;
    }
    // Open in a new tab — on return, the driver comes back to this page with
    // ?stripe_return=1 and we re-check status automatically.
    window.open(result.data.url, '_blank', 'noopener,noreferrer');
    setState('idle');
  };

  const handleContinueOnboarding = async () => {
    setState('refreshing');
    const result = await refreshStripeConnectLink();
    if (!result.success || !result.data?.url) {
      setState('error');
      setErrorMsg(result.error ?? 'Failed to get setup link.');
      return;
    }
    window.open(result.data.url, '_blank', 'noopener,noreferrer');
    setState('partial');
  };

  if (!driver) return null;

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Set Up Payouts" onBack={() => navigate('/settings')} />

      <div style={{ padding: 24, maxWidth: 480, margin: '0 auto' }}>
        {/* Status card */}
        {(state === 'loading_status' || state === 'refreshing') && (
          <div style={{ textAlign: 'center', marginTop: 64 }}>
            <Spinner size={32} color={colors.navy} />
            <div style={{ marginTop: 16, fontSize: 14, color: colors.textMuted }}>
              {state === 'refreshing' ? 'Opening setup…' : 'Checking account status…'}
            </div>
          </div>
        )}

        {state === 'complete' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: colors.navy, marginBottom: 8 }}>
                Payouts Enabled
              </div>
              <div style={{ fontSize: 14, color: colors.textMuted }}>
                Your bank account or debit card is connected. You're all set to receive earnings.
              </div>
            </div>

            <Card padding={16} style={{ marginBottom: 16 }}>
              <StatusRow label="Payment Account" value="✅ Connected" valueColor={colors.success} />
              <StatusRow
                label="Payouts"
                value={status?.payoutsEnabled ? '✅ Enabled' : '⏳ Pending'}
                valueColor={status?.payoutsEnabled ? colors.success : colors.warning}
              />
              <StatusRow
                label="Instant Pay"
                value={status?.hasDebitCard ? '✅ Debit card linked' : '💳 Bank account only'}
                valueColor={status?.hasDebitCard ? colors.success : colors.info}
              />
            </Card>

            {!status?.hasDebitCard && (
              <Card
                padding={14}
                style={{ marginBottom: 20, background: colors.infoBg, border: 'none' }}
              >
                <div style={{ fontSize: 13, color: colors.info }}>
                  💳 Add a debit card in Stripe to enable instant payouts (arrives in minutes). Bank
                  accounts support free 2-3 day transfers only.
                </div>
                <button
                  type="button"
                  onClick={handleContinueOnboarding}
                  className="btn btn-ghost btn-sm"
                  style={{
                    marginTop: 10, color: colors.info,
                    textDecoration: 'underline', boxShadow: 'none',
                    padding: '4px 0',
                  }}
                >
                  Add debit card in Stripe →
                </button>
              </Card>
            )}

            <Button
              onClick={() => navigate('/instant-pay')}
              variant="primary"
              fullWidth
              size="lg"
            >
              Go to Instant Pay
            </Button>
          </>
        )}

        {(state === 'idle' || state === 'launching') && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>🏦</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: colors.navy, marginBottom: 8 }}>
                Connect Your Bank
              </div>
              <div style={{ fontSize: 14, color: colors.textMuted, lineHeight: 1.6 }}>
                Set up your payout account to receive earnings from completed rides.
                Your information is securely handled by Stripe.
              </div>
            </div>

            <Card padding={16} style={{ marginBottom: 20 }}>
              <FeatureRow emoji="⚡" title="Instant Pay" body="Cash out to a debit card in minutes (small fee applies)" />
              <FeatureRow emoji="🏦" title="Standard Payout" body="Free weekly transfer to your bank account" />
              <FeatureRow emoji="🔒" title="Secure & Encrypted" body="Your banking details are stored and managed by Stripe, never by My Car Concierge" />
            </Card>

            <Button
              onClick={handleStartOnboarding}
              variant="primary"
              fullWidth
              size="lg"
              disabled={state === 'launching'}
              style={{ marginBottom: 12 }}
            >
              {state === 'launching' ? 'Opening Stripe…' : 'Connect with Stripe'}
            </Button>

            <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', lineHeight: 1.5 }}>
              You'll be redirected to Stripe to verify your identity and link your bank or debit card.
              Return here when finished.
            </div>
          </>
        )}

        {state === 'partial' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>⏳</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: colors.navy, marginBottom: 8 }}>
                Setup Incomplete
              </div>
              <div style={{ fontSize: 14, color: colors.textMuted, lineHeight: 1.6 }}>
                Your Stripe account has been created but setup isn't finished yet. Complete
                the remaining steps to start receiving payouts.
              </div>
            </div>

            <Card
              padding={14}
              style={{ marginBottom: 20, background: colors.warningBg, border: 'none' }}
            >
              <div style={{ fontSize: 13, color: colors.warning }}>
                ⚠️ Finish identity verification and add a payout method in Stripe to enable payouts.
              </div>
            </Card>

            <Button
              onClick={handleContinueOnboarding}
              variant="primary"
              fullWidth
              size="lg"
              disabled={state !== 'partial'}
              style={{ marginBottom: 12 }}
            >
              Continue Setup in Stripe
            </Button>

            <button
              type="button"
              onClick={fetchStatus}
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Check status again
            </button>
          </>
        )}

        {state === 'error' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 56, marginBottom: 16 }}>⚠️</div>
              <div style={{ fontSize: 20, fontWeight: 600, color: colors.navy, marginBottom: 8 }}>
                Something went wrong
              </div>
              <div style={{ fontSize: 14, color: colors.textMuted }}>
                {errorMsg}
              </div>
            </div>

            <Button onClick={fetchStatus} variant="secondary" fullWidth>
              Try Again
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Helper sub-components ─────────────────────────────────────────────────────

function StatusRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: `1px solid ${colors.borderLight}`,
    }}>
      <span style={{ fontSize: 14, color: colors.textPrimary }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: valueColor ?? colors.textSecondary }}>
        {value}
      </span>
    </div>
  );
}

function FeatureRow({
  emoji,
  title,
  body,
}: {
  emoji: string;
  title: string;
  body: string;
}) {
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'flex-start',
      padding: '12px 0', borderBottom: `1px solid ${colors.borderLight}`,
    }}>
      <div style={{ fontSize: 20, minWidth: 28, textAlign: 'center', marginTop: 1 }}>{emoji}</div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 12, color: colors.textMuted, lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}

