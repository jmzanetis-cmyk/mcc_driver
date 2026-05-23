// ============================================================
// MCC Driver — Tax Estimator Screen (Phase 2C)
// ============================================================
// Quarterly self-employment tax estimate based on earnings,
// mileage deduction, and business expenses.
// ============================================================

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/services/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { apiUrl } from '@/services/api/baseUrl';
import { PageHeader, Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { formatCurrency } from '@/utils/formatters';

interface TaxEstimate {
  year: number;
  currentQuarter: number;
  inputs: {
    grossEarnings: number;
    totalMiles: number;
    mileageDeduction: number;
    expenseDeduction: number;
    netIncome: number;
  };
  taxes: {
    seTax: number;
    incomeTax: number;
    annualTax: number;
    quarterlyPayment: number;
  };
  rates: {
    irsRatePerMile: number;
    seTaxRate: number;
    incomeTaxRate: number;
  };
  disclaimer: string;
}

const QUARTER_LABELS = ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)'];
const QUARTER_DUE_DATES = ['Apr 15', 'Jun 16', 'Sep 15', 'Jan 15'];

async function authFetch(path: string) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(apiUrl(path), {
    headers: { Authorization: `Bearer ${session?.access_token}` },
  });
}

function LineItem({ label, value, sublabel, bold, color }: {
  label: string; value: string; sublabel?: string;
  bold?: boolean; color?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '8px 0' }}>
      <div>
        <div style={{ fontSize: 13, color: colors.navy, fontWeight: bold ? 700 : 400 }}>{label}</div>
        {sublabel && <div style={{ fontSize: 10, color: colors.textMuted, marginTop: 1 }}>{sublabel}</div>}
      </div>
      <div style={{ fontSize: 13, fontWeight: bold ? 700 : 600, color: color ?? colors.navy }}>{value}</div>
    </div>
  );
}

export function TaxEstimatorScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const [year, setYear] = useState(new Date().getFullYear());

  const { data: estimate, isLoading, isError } = useQuery({
    queryKey: ['tax-estimate', driver?.id, year],
    queryFn: async () => {
      const res = await authFetch(`/tax-estimate?year=${year}`);
      if (!res.ok) throw new Error('Failed to fetch tax estimate');
      return res.json() as Promise<TaxEstimate>;
    },
    enabled: !!driver?.id,
    staleTime: 60_000,
  });

  const currentYear = new Date().getFullYear();

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Tax Estimator" onBack={() => navigate('/earnings')} />

      <div style={{ padding: 20 }}>

        {/* Year selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[currentYear - 1, currentYear].map(y => (
            <button
              key={y}
              onClick={() => setYear(y)}
              style={{
                flex: 1, padding: '10px 0', border: 'none', borderRadius: borderRadius.md,
                fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                background: year === y ? colors.navy : colors.bgSecondary,
                color: year === y ? colors.textWhite : colors.textMuted,
              }}
            >
              {y}
            </button>
          ))}
        </div>

        {isLoading && (
          <div style={{ textAlign: 'center', padding: 48 }}><Spinner color={colors.textMuted} /></div>
        )}

        {isError && (
          <Card padding={24}>
            <div style={{ textAlign: 'center', color: colors.textMuted }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
              <div>Couldn't load tax estimate.</div>
            </div>
          </Card>
        )}

        {estimate && (
          <>
            {/* Quarterly payment hero */}
            <div style={{
              background: colors.surfaceDark, borderRadius: borderRadius.lg,
              padding: 24, marginBottom: 16, textAlign: 'center',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                Estimated Quarterly Tax
              </div>
              <div className="heading-editorial on-dark" style={{ fontSize: 'clamp(2.5rem, 10vw, 3.5rem)', margin: '4px 0' }}>
                {formatCurrency(estimate.taxes.quarterlyPayment)}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                {QUARTER_LABELS[(estimate.currentQuarter - 1)] ?? ''} — due {QUARTER_DUE_DATES[(estimate.currentQuarter - 1)] ?? ''}
              </div>
            </div>

            {/* Quarterly calendar */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {[1, 2, 3, 4].map(q => (
                <div
                  key={q}
                  style={{
                    flex: 1, padding: '10px 4px', borderRadius: borderRadius.sm,
                    textAlign: 'center',
                    background: q === estimate.currentQuarter ? colors.navy : colors.bgSecondary,
                    color: q === estimate.currentQuarter ? colors.textWhite : colors.textMuted,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700 }}>Q{q}</div>
                  <div style={{ fontSize: 10, marginTop: 2 }}>{QUARTER_DUE_DATES[q - 1]}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4 }}>
                    {formatCurrency(estimate.taxes.quarterlyPayment)}
                  </div>
                </div>
              ))}
            </div>

            {/* Income breakdown */}
            <Card padding={16} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Income & Deductions ({estimate.year})
              </div>
              <div style={{ borderTop: `1px solid ${colors.borderLight}` }}>
                <LineItem
                  label="Gross Earnings"
                  value={formatCurrency(estimate.inputs.grossEarnings)}
                />
                <div style={{ borderTop: `1px solid ${colors.borderLight}` }} />
                <LineItem
                  label="Mileage Deduction"
                  sublabel={`${estimate.inputs.totalMiles.toFixed(1)} mi × $${estimate.rates.irsRatePerMile}/mi (IRS 2026)`}
                  value={`− ${formatCurrency(estimate.inputs.mileageDeduction)}`}
                  color={colors.success}
                />
                <LineItem
                  label="Business Expenses"
                  value={`− ${formatCurrency(estimate.inputs.expenseDeduction)}`}
                  color={colors.success}
                />
                <div style={{ borderTop: `1px solid ${colors.borderLight}` }} />
                <LineItem
                  label="Net Self-Employment Income"
                  value={formatCurrency(estimate.inputs.netIncome)}
                  bold
                />
              </div>
            </Card>

            {/* Tax breakdown */}
            <Card padding={16} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                Tax Breakdown
              </div>
              <div style={{ borderTop: `1px solid ${colors.borderLight}` }}>
                <LineItem
                  label="Self-Employment Tax"
                  sublabel={`${(estimate.rates.seTaxRate * 100).toFixed(1)}% × 92.35% of net income`}
                  value={formatCurrency(estimate.taxes.seTax)}
                />
                <LineItem
                  label="Federal Income Tax (est.)"
                  sublabel={`${(estimate.rates.incomeTaxRate * 100).toFixed(0)}% bracket — includes SE deduction`}
                  value={formatCurrency(estimate.taxes.incomeTax)}
                />
                <div style={{ borderTop: `1px solid ${colors.borderLight}` }} />
                <LineItem
                  label="Total Annual Tax"
                  value={formatCurrency(estimate.taxes.annualTax)}
                  bold
                />
                <LineItem
                  label="Quarterly Payment"
                  value={formatCurrency(estimate.taxes.quarterlyPayment)}
                  bold
                  color={colors.warning}
                />
              </div>
            </Card>

            {/* Disclaimer */}
            <Card padding={14}>
              <div style={{ fontSize: 11, color: colors.textMuted, lineHeight: 1.5 }}>
                ⚠️ {estimate.disclaimer}
              </div>
            </Card>

            {/* Quick links */}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => navigate('/mileage')}
                style={{
                  flex: 1, padding: '12px 0', background: colors.bgSecondary,
                  color: colors.navy, border: 'none', borderRadius: borderRadius.full,
                  fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                🚗 Log Mileage
              </button>
              <button
                onClick={() => navigate('/expenses')}
                style={{
                  flex: 1, padding: '12px 0', background: colors.bgSecondary,
                  color: colors.navy, border: 'none', borderRadius: borderRadius.full,
                  fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                🧾 Add Expense
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
