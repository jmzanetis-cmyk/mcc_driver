// ============================================================
// MCC Driver — Business Expenses Screen (Phase 2C)
// ============================================================
// Log deductible business expenses: gas, car wash, phone, etc.
// ============================================================

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/services/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { apiUrl } from '@/services/api/baseUrl';
import { PageHeader, Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { formatCurrency, formatDate } from '@/utils/formatters';

type ExpenseCategory = 'gas' | 'car_wash' | 'phone' | 'insurance' | 'maintenance' | 'parking' | 'tolls' | 'other';

const CATEGORY_META: Record<ExpenseCategory, { label: string; icon: string }> = {
  gas:         { label: 'Gas',         icon: '⛽' },
  car_wash:    { label: 'Car Wash',    icon: '🚿' },
  phone:       { label: 'Phone',       icon: '📱' },
  insurance:   { label: 'Insurance',   icon: '🛡️' },
  maintenance: { label: 'Maintenance', icon: '🔧' },
  parking:     { label: 'Parking',     icon: '🅿️' },
  tolls:       { label: 'Tolls',       icon: '🛣️' },
  other:       { label: 'Other',       icon: '📋' },
};

interface Expense {
  id: string;
  category: ExpenseCategory;
  amount_cents: number;
  expense_date: string;
  description: string | null;
  receipt_url: string | null;
}

interface ExpenseSummary {
  totalCents: number;
  totalDollars: number;
  byCategory: Record<string, number>;
  year: number;
}

async function authFetch(path: string, options?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token}`,
      ...(options?.headers ?? {}),
    },
  });
}

export function ExpensesScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const queryClient = useQueryClient();

  const [category, setCategory] = useState<ExpenseCategory>('gas');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().split('T')[0]!);
  const [description, setDescription] = useState('');
  const [filterCategory, setFilterCategory] = useState<ExpenseCategory | 'all'>('all');
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', driver?.id],
    queryFn: async () => {
      const res = await authFetch('/expenses');
      if (!res.ok) throw new Error('Failed to fetch expenses');
      return res.json() as Promise<{ expenses: Expense[]; summary: ExpenseSummary }>;
    },
    enabled: !!driver?.id,
    staleTime: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: async (body: object) => {
      const res = await authFetch('/expenses', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? 'Failed to save');
      }
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setAmount('');
      setDescription('');
      setFormError(null);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await authFetch(`/expenses/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const dollars = parseFloat(amount);
    if (!dollars || dollars <= 0) { setFormError('Enter a valid amount'); return; }
    addMutation.mutate({
      category,
      amountCents: Math.round(dollars * 100),
      expenseDate,
      description: description || undefined,
    });
  }

  const allExpenses = data?.expenses ?? [];
  const summary = data?.summary;
  const filtered = filterCategory === 'all' ? allExpenses : allExpenses.filter(e => e.category === filterCategory);

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Business Expenses" onBack={() => navigate('/earnings')} />

      <div style={{ padding: 20 }}>

        {/* Summary hero */}
        <div style={{
          background: colors.surfaceDark, borderRadius: borderRadius.lg,
          padding: 20, marginBottom: 16, textAlign: 'center',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            {summary?.year ?? new Date().getFullYear()} Total Expenses
          </div>
          <div className="heading-editorial on-dark" style={{ fontSize: 'clamp(2rem, 8vw, 2.75rem)', margin: '4px 0' }}>
            {formatCurrency(summary?.totalDollars ?? 0)}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
            {allExpenses.length} expense{allExpenses.length !== 1 ? 's' : ''} logged
          </div>
        </div>

        {/* Category breakdown */}
        {summary && Object.keys(summary.byCategory).length > 0 && (
          <Card padding={14} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
              By Category
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(summary.byCategory)
                .sort(([, a], [, b]) => b - a)
                .map(([cat, cents]) => {
                  const meta = CATEGORY_META[cat as ExpenseCategory] ?? { label: cat, icon: '📋' };
                  return (
                    <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: 13, color: colors.navy }}>
                        {meta.icon} {meta.label}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: colors.navy }}>
                        {formatCurrency(cents / 100)}
                      </div>
                    </div>
                  );
                })}
            </div>
          </Card>
        )}

        {/* Add expense form */}
        <Card padding={16} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>
            Add Expense
          </div>
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Category</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value as ExpenseCategory)}
                  className="form-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                >
                  {(Object.keys(CATEGORY_META) as ExpenseCategory[]).map(c => (
                    <option key={c} value={c}>{CATEGORY_META[c].icon} {CATEGORY_META[c].label}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Amount ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Date</label>
                  <input
                    type="date"
                    value={expenseDate}
                    onChange={e => setExpenseDate(e.target.value)}
                    className="form-input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: colors.textMuted, display: 'block', marginBottom: 4 }}>Notes (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Shell on Oak St"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="form-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
              </div>
              {formError && (
                <div style={{ fontSize: 12, color: colors.error }}>{formError}</div>
              )}
              <button
                type="submit"
                disabled={addMutation.isPending}
                style={{
                  padding: '12px 0', background: colors.navy, color: colors.textWhite,
                  border: 'none', borderRadius: borderRadius.full, fontSize: 14,
                  fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  opacity: addMutation.isPending ? 0.6 : 1,
                }}
              >
                {addMutation.isPending ? 'Saving…' : 'Add Expense'}
              </button>
            </div>
          </form>
        </Card>

        {/* Category filter */}
        {allExpenses.length > 0 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 12, paddingBottom: 4 }}>
            {(['all', ...Object.keys(CATEGORY_META)] as (ExpenseCategory | 'all')[]).map(c => (
              <button
                key={c}
                onClick={() => setFilterCategory(c)}
                style={{
                  flexShrink: 0, padding: '6px 12px', border: 'none', borderRadius: borderRadius.full,
                  fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  background: filterCategory === c ? colors.navy : colors.bgSecondary,
                  color: filterCategory === c ? colors.textWhite : colors.textMuted,
                }}
              >
                {c === 'all' ? 'All' : `${CATEGORY_META[c as ExpenseCategory].icon} ${CATEGORY_META[c as ExpenseCategory].label}`}
              </button>
            ))}
          </div>
        )}

        {/* Expense list */}
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}><Spinner color={colors.textMuted} /></div>
        ) : filtered.length === 0 ? (
          <Card padding={24}>
            <div style={{ textAlign: 'center', color: colors.textMuted }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🧾</div>
              <div style={{ fontSize: 14 }}>No expenses logged yet.</div>
            </div>
          </Card>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(exp => {
              const meta = CATEGORY_META[exp.category] ?? { label: exp.category, icon: '📋' };
              return (
                <Card key={exp.id} padding={14}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: colors.navy }}>
                        {meta.icon} {meta.label}
                      </div>
                      <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                        {formatDate(exp.expense_date)}
                      </div>
                      {exp.description && (
                        <div style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>{exp.description}</div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: colors.navy }}>
                        {formatCurrency(exp.amount_cents / 100)}
                      </div>
                      <button
                        onClick={() => deleteMutation.mutate(exp.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: colors.error, padding: 0 }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
