import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { supabase } from '@/services/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader, Card, Button, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';

const BASE_URL = 'https://www.mycarconcierge.com';

type FounderState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'no_application' }
  | { kind: 'pending' }
  | { kind: 'rejected'; reason: string | null }
  | { kind: 'active'; referralCode: string; signupUrl: string };

type EarningsData = {
  maturing: number;
  payable: number;
  paidYtd: number;
  providers: number;
  commissionRate: number;
  nextPayout: string | null;
};

type EarningsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; data: EarningsData }
  | { kind: 'error' };

async function generateQR(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    width: 220,
    margin: 2,
    color: { dark: '#1B2A4A', light: '#FAF7F0' },
  });
}

export function DriverFounderScreen() {
  const navigate = useNavigate();
  const { driver, user } = useAuth();
  const [founderState, setFounderState] = useState<FounderState>({ kind: 'loading' });
  const [earningsState, setEarningsState] = useState<EarningsState>({ kind: 'idle' });
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  // Apply form
  const [showApplyForm, setShowApplyForm] = useState(false);
  const [motivation, setMotivation] = useState('');
  const [location, setLocation] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreeContractor, setAgreeContractor] = useState(false);
  const [agreeCommission, setAgreeCommission] = useState(false);
  const [agreeAccurate, setAgreeAccurate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!user || !driver) return;
    void load(user.id, driver.email);
  }, [user?.id]);

  async function load(userId: string, email: string) {
    setFounderState({ kind: 'loading' });
    try {
      const { data: profile } = await supabase
        .from('member_founder_profiles')
        .select('referral_code, status')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();

      if (profile?.referral_code) {
        const signupUrl = `${BASE_URL}/signup-provider?ref=${profile.referral_code}`;
        setFounderState({ kind: 'active', referralCode: profile.referral_code as string, signupUrl });
        void generateQR(signupUrl).then(setQrDataUrl);
        void loadEarnings();
        return;
      }

      const { data: application } = await supabase
        .from('member_founder_applications')
        .select('status, rejection_reason')
        .eq('email', email)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!application) {
        setFounderState({ kind: 'no_application' });
        return;
      }

      if (application.status === 'pending' || application.status === 'approved') {
        setFounderState({ kind: 'pending' });
      } else if (application.status === 'rejected') {
        setFounderState({ kind: 'rejected', reason: (application.rejection_reason as string | null) ?? null });
      } else {
        setFounderState({ kind: 'no_application' });
      }
    } catch {
      setFounderState({ kind: 'error', message: 'Could not load founder status. Check your connection and try again.' });
    }
  }

  async function loadEarnings() {
    setEarningsState({ kind: 'loading' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) { setEarningsState({ kind: 'error' }); return; }
      const res = await fetch(`${BASE_URL}/api/member-founder/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { setEarningsState({ kind: 'error' }); return; }
      const payload = await res.json() as {
        success?: boolean;
        profile?: {
          balance_breakdown?: { maturing_amount?: number; payable_amount?: number; paid_amount_ytd?: number };
          total_provider_referrals?: number;
          commission_rate?: number;
          next_payout_date?: string;
        };
      };
      if (!payload.success || !payload.profile) { setEarningsState({ kind: 'error' }); return; }
      const bd = payload.profile.balance_breakdown ?? {};
      setEarningsState({
        kind: 'loaded',
        data: {
          maturing:      bd.maturing_amount  ?? 0,
          payable:       bd.payable_amount   ?? 0,
          paidYtd:       bd.paid_amount_ytd  ?? 0,
          providers:     payload.profile.total_provider_referrals ?? 0,
          commissionRate: payload.profile.commission_rate ?? 0.5,
          nextPayout:    payload.profile.next_payout_date ?? null,
        },
      });
    } catch {
      setEarningsState({ kind: 'error' });
    }
  }

  async function handleSubmit() {
    if (!user || !driver) return;
    if (!agreeTerms || !agreeContractor || !agreeCommission || !agreeAccurate) {
      setSubmitError('Please agree to all terms to submit.');
      return;
    }
    if (!motivation.trim()) {
      setSubmitError('Please describe your motivation.');
      return;
    }

    setSubmitting(true);
    setSubmitError('');

    const { error } = await supabase
      .from('member_founder_applications')
      .insert({
        full_name: `${driver.firstName} ${driver.lastName}`,
        email: driver.email,
        phone: driver.phone,
        location: location.trim() || null,
        promotion_method: 'word_of_mouth',
        motivation: motivation.trim(),
        program: 'member_founder',
        status: 'pending',
        agreements_accepted: {
          terms_of_service: true,
          independent_contractor: true,
          commission_terms: true,
          accurate_information: true,
          accepted_at: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
      });

    setSubmitting(false);

    if (error) {
      setSubmitError('Submission failed. Please try again.');
      return;
    }

    setFounderState({ kind: 'pending' });
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare(signupUrl: string, referralCode: string) {
    const title = 'Join MCC as a Service Provider';
    const text = `Become a My Car Concierge provider — premium automotive services for luxury clients. Referral code: ${referralCode}`;
    if (navigator.share) {
      await navigator.share({ title, text, url: signupUrl }).catch(() => {});
    } else {
      await handleCopy(signupUrl);
    }
  }

  function renderContent() {
    switch (founderState.kind) {
      case 'loading':
        return (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 64 }}>
            <Spinner />
          </div>
        );
      case 'error':
        return (
          <Card padding={24}>
            <div style={{ textAlign: 'center', color: colors.error, fontSize: 14, marginBottom: 16 }}>
              {founderState.message}
            </div>
            <Button
              onClick={() => user && driver && void load(user.id, driver.email)}
              variant="secondary"
              fullWidth
              size="md"
            >
              Try Again
            </Button>
          </Card>
        );
      case 'active':
        return renderActive(founderState.referralCode, founderState.signupUrl);
      case 'pending':
        return renderPending();
      case 'rejected':
        return renderRejected(founderState.reason);
      case 'no_application':
        return showApplyForm ? renderApplyForm() : renderInfo();
    }
  }

  function renderInfo() {
    return (
      <>
        <Card padding={20} style={{ marginBottom: 16, background: colors.surfaceDark, border: `1px solid ${colors.gold}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.gold, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Driver Founder Program
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#FAF7F0', marginBottom: 8, lineHeight: 1.3 }}>
            Earn 50% on every provider you refer — for life.
          </div>
          <div style={{ fontSize: 13, color: 'rgba(250,247,240,0.75)', lineHeight: 1.6 }}>
            You visit shops, garages, and dealerships every day on the job. Refer them to MCC and earn half of every bid-pack purchase they make on the platform — forever.
          </div>
        </Card>

        <Card padding={16} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            How it works
          </div>
          {[
            { icon: '🤝', title: 'Apply once', desc: 'Your application is reviewed and approved by the MCC team.' },
            { icon: '🔗', title: 'Get your referral code', desc: 'Once approved, you receive a unique code and QR to show providers.' },
            { icon: '💰', title: 'Earn 50% commissions', desc: 'Every time a referred provider buys bid credits, you earn 50% of that purchase.' },
            { icon: '📅', title: 'Monthly payouts', desc: 'Commissions clear after a 7-day holding period, then pay out in the monthly run on the 1st.' },
          ].map(({ icon, title, desc }, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
              <span style={{ fontSize: 22, flexShrink: 0, marginTop: 1 }}>{icon}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy, marginBottom: 2 }}>{title}</div>
                <div style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.5 }}>{desc}</div>
              </div>
            </div>
          ))}
        </Card>

        <Card padding={14} style={{ marginBottom: 20, background: colors.infoBg, border: `1px solid ${colors.info}` }}>
          <div style={{ fontSize: 12, color: colors.info, lineHeight: 1.6 }}>
            <strong>Payout timing:</strong> Each commission is held for 7 days after it is earned — so any refund or dispute can be processed before the commission is released. Once cleared, it becomes payable and is included in the next monthly payout run on the 1st. A commission earned just after the 1st could take up to ~38 days to arrive; one earned just before the 1st arrives much sooner. Balances below $25 roll over to the next month.
          </div>
        </Card>

        <Button onClick={() => setShowApplyForm(true)} variant="primary" fullWidth size="lg">
          Apply to the Founder Program
        </Button>
      </>
    );
  }

  function renderApplyForm() {
    return (
      <>
        <Card padding={16} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: colors.navy, marginBottom: 4 }}>
            Driver Founder Application
          </div>
          <div style={{ fontSize: 12, color: colors.textMuted }}>
            Pre-filled from your driver profile. Add the remaining details and agree to the terms below.
          </div>
        </Card>

        <Card padding={16} style={{ marginBottom: 16 }}>
          <FieldDisplay label="Name" value={driver ? `${driver.firstName} ${driver.lastName}` : ''} />
          <FieldDisplay label="Email" value={driver?.email ?? ''} />
          <FieldDisplay label="Phone" value={driver?.phone ?? ''} />
        </Card>

        <Card padding={16} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Your City / Area
          </div>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. Los Angeles, CA"
            style={{
              width: '100%', padding: '10px 12px', borderRadius: borderRadius.sm,
              border: `1px solid ${colors.border}`, background: colors.bgSecondary,
              fontSize: 14, color: colors.navy, boxSizing: 'border-box', fontFamily: 'inherit',
            }}
          />
        </Card>

        <Card padding={16} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Why do you want to join?{' '}
            <span aria-hidden="true" style={{ color: colors.error }}>*</span>
          </div>
          <textarea
            value={motivation}
            onChange={(e) => setMotivation(e.target.value)}
            placeholder="Describe the providers you'll refer and how you plan to promote MCC…"
            rows={4}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: borderRadius.sm,
              border: `1px solid ${colors.border}`, background: colors.bgSecondary,
              fontSize: 14, color: colors.navy, resize: 'vertical', fontFamily: 'inherit',
              lineHeight: 1.5, boxSizing: 'border-box',
            }}
          />
        </Card>

        <Card padding={16} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            Agreements
          </div>
          {([
            { key: 'terms', label: 'I agree to the MCC Terms of Service and Founder Program terms.', checked: agreeTerms, set: setAgreeTerms },
            { key: 'contractor', label: 'I understand I am an independent contractor, not an employee.', checked: agreeContractor, set: setAgreeContractor },
            { key: 'commission', label: 'I understand commissions are held for 7 days and paid in monthly batches. Payout is not instant.', checked: agreeCommission, set: setAgreeCommission },
            { key: 'accurate', label: 'The information I have provided is accurate and truthful.', checked: agreeAccurate, set: setAgreeAccurate },
          ] as const).map(({ key, label, checked, set }) => (
            <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => set(e.target.checked)}
                style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, accentColor: 'var(--accent-gold)' }}
              />
              <span style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5 }}>{label}</span>
            </label>
          ))}
        </Card>

        {submitError && (
          <div style={{ color: colors.error, fontSize: 13, marginBottom: 12, textAlign: 'center' }}>
            {submitError}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button
            onClick={() => void handleSubmit()}
            variant="primary"
            fullWidth
            size="lg"
            disabled={submitting}
            loading={submitting}
          >
            Submit Application
          </Button>
          <Button
            onClick={() => { setShowApplyForm(false); setSubmitError(''); }}
            variant="ghost"
            fullWidth
            size="md"
          >
            Back
          </Button>
        </div>
      </>
    );
  }

  function renderPending() {
    return (
      <Card padding={24} style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: colors.navy, marginBottom: 8 }}>
          Application Under Review
        </div>
        <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6 }}>
          Your Driver Founder application is pending review by the MCC team. You'll be notified once a decision is made.
        </div>
        <div style={{
          marginTop: 20, padding: '12px 16px',
          background: colors.warningBg, borderRadius: borderRadius.md,
          fontSize: 12, color: colors.warning, lineHeight: 1.5,
        }}>
          Once approved, you'll receive a referral code and QR to share with providers.
        </div>
      </Card>
    );
  }

  function renderRejected(reason: string | null) {
    return (
      <>
        <Card padding={24} style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: colors.navy, marginBottom: 8 }}>
            Application Not Approved
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6 }}>
            Your previous application was not approved.
            {reason ? <> Reason: <em>{reason}</em>.</> : null}
          </div>
        </Card>
        <Button
          onClick={() => {
            setMotivation('');
            setLocation('');
            setAgreeTerms(false);
            setAgreeContractor(false);
            setAgreeCommission(false);
            setAgreeAccurate(false);
            setShowApplyForm(true);
            setFounderState({ kind: 'no_application' });
          }}
          variant="primary"
          fullWidth
          size="lg"
        >
          Apply Again
        </Button>
      </>
    );
  }

  function renderActive(referralCode: string, signupUrl: string) {
    return (
      <>
        <Card padding={16} style={{ marginBottom: 16, background: colors.surfaceDark, border: `1px solid ${colors.gold}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 28 }}>⭐</span>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.gold, textTransform: 'uppercase', letterSpacing: 1 }}>
                Active Driver Founder
              </div>
              <div style={{ fontSize: 13, color: 'rgba(250,247,240,0.75)', marginTop: 2 }}>
                Share your code with providers to earn 50% of their bid-pack purchases.
              </div>
            </div>
          </div>
        </Card>

        <Card padding={24} style={{ marginBottom: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 16 }}>
            Provider Signup QR
          </div>
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="Provider signup QR code"
              style={{ width: 220, height: 220, borderRadius: borderRadius.md, margin: '0 auto', display: 'block', border: `3px solid ${colors.gold}` }}
            />
          ) : (
            <div style={{ width: 220, height: 220, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spinner />
            </div>
          )}
          <div style={{
            marginTop: 14, fontSize: 11, color: colors.textMuted, fontFamily: 'monospace',
            background: colors.bgSecondary, padding: '6px 12px',
            borderRadius: borderRadius.full, display: 'inline-block',
          }}>
            Code: {referralCode}
          </div>
        </Card>

        <Card padding={14} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: colors.textMuted, marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Provider Signup Link
          </div>
          <div style={{ fontSize: 12, color: colors.navy, wordBreak: 'break-all', fontFamily: 'monospace', lineHeight: 1.5 }}>
            {signupUrl}
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
          <Button onClick={() => void handleShare(signupUrl, referralCode)} variant="primary" fullWidth size="lg">
            {typeof navigator !== 'undefined' && 'share' in navigator ? '↑ Share Link' : '↑ Share / Copy'}
          </Button>
          <Button onClick={() => void handleCopy(signupUrl)} variant="secondary" fullWidth size="md">
            {copied ? '✓ Copied!' : '⎘ Copy Link'}
          </Button>
          {qrDataUrl && (
            <Button
              onClick={() => {
                const a = document.createElement('a');
                a.href = qrDataUrl;
                a.download = `mcc-founder-${referralCode}.png`;
                a.click();
              }}
              variant="ghost"
              fullWidth
              size="md"
            >
              ↓ Download QR Code
            </Button>
          )}
        </div>

        <div style={{ fontSize: 11, color: colors.textMuted, lineHeight: 1.5, marginBottom: 24, padding: '8px 12px', background: colors.bgSecondary, borderRadius: borderRadius.sm }}>
          <strong>Disclosure:</strong> you earn a commission when referred providers purchase bid credits. Providers are informed of this relationship at signup.
        </div>

        <Card padding={14} style={{ marginBottom: 16, background: colors.infoBg, border: `1px solid ${colors.info}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.info, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Payout Timing
          </div>
          <div style={{ fontSize: 12, color: colors.info, lineHeight: 1.6 }}>
            Commissions are held for 7 days after they're earned, then included in the monthly payout run on the 1st. A commission earned just after the 1st could take up to ~38 days; one earned just before the 1st arrives sooner. Minimum payout balance: $25 (remainder rolls over).
          </div>
        </Card>

        <Card padding={16}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
            Earnings Dashboard
          </div>
          {renderEarnings()}
        </Card>
      </>
    );
  }

  function renderEarnings() {
    if (earningsState.kind === 'loading') {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
          <Spinner />
        </div>
      );
    }
    if (earningsState.kind === 'error') {
      return (
        <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', padding: 8 }}>
          Could not load earnings data.
        </div>
      );
    }
    if (earningsState.kind !== 'loaded') return null;
    const { data } = earningsState;
    const metrics: Array<{ label: string; value: string; sub: string; color: string }> = [
      { label: 'Maturing',  value: `$${data.maturing.toFixed(2)}`,  sub: '7-day hold',      color: colors.info    },
      { label: 'Payable',   value: `$${data.payable.toFixed(2)}`,   sub: 'Ready for payout', color: colors.gold    },
      { label: 'Paid YTD',  value: `$${data.paidYtd.toFixed(2)}`,   sub: 'This year',        color: colors.success },
      { label: 'Providers', value: String(data.providers),           sub: 'Referred',         color: colors.navy    },
    ];
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          {metrics.map(({ label, value, sub, color }) => (
            <div key={label} style={{ background: colors.bgSecondary, borderRadius: borderRadius.md, padding: '12px 14px' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color, marginBottom: 2 }}>{value}</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
              <div style={{ fontSize: 10, color: colors.textMuted }}>{sub}</div>
            </div>
          ))}
        </div>
        {data.nextPayout && (
          <div style={{ fontSize: 11, color: colors.textMuted, textAlign: 'center' }}>
            Next payout:{' '}
            <strong style={{ color: colors.navy }}>
              {new Date(data.nextPayout).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </strong>
          </div>
        )}
      </>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Driver Founder" onBack={() => navigate('/settings')} />
      <div style={{ padding: 20 }}>
        {renderContent()}
        <div style={{ height: 32 }} />
      </div>
    </div>
  );
}

function FieldDisplay({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: colors.navy }}>{value || '—'}</div>
    </div>
  );
}
