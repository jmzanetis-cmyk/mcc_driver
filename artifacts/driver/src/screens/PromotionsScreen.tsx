// ============================================================
// MCC Driver — Promotions & Quests Screen
// ============================================================

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/services/supabase/client';
import { PageHeader, Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { apiUrl } from '@/services/api/baseUrl';
import { formatCurrency, formatDate } from '@/utils/formatters';

interface Promotion {
  id: string;
  type: string;
  title: string;
  description: string;
  target_count: number;
  current_count: number;
  reward_amount: number;
  starts_at: string;
  ends_at: string | null;
  status: 'active' | 'completed' | 'expired';
  completed_at: string | null;
}

const TYPE_META: Record<string, { icon: string; color: string }> = {
  streak:           { icon: '🔥', color: '#EA580C' },
  weekly_challenge: { icon: '🎯', color: colors.navy },
  bonus:            { icon: '💰', color: colors.success },
};

export function PromotionsScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!driver) return;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(apiUrl('/promotions'), {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          const j = await res.json() as { promotions: Promotion[] };
          setPromotions(j.promotions);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [driver?.id]);

  const active = promotions.filter((p) => p.status === 'active');
  const completed = promotions.filter((p) => p.status === 'completed');

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Promotions & Quests" onBack={() => navigate('/settings')} />

      <div style={{ padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>
        ) : promotions.length === 0 ? (
          <Card padding={32}>
            <div style={{ textAlign: 'center', color: colors.textMuted }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎯</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No active promotions</div>
              <div style={{ fontSize: 13 }}>Check back soon — new quests are added weekly.</div>
            </div>
          </Card>
        ) : (
          <>
            {active.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                  Active
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                  {active.map((p) => <PromotionCard key={p.id} promo={p} />)}
                </div>
              </>
            )}

            {completed.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
                  Completed
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {completed.map((p) => <PromotionCard key={p.id} promo={p} />)}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PromotionCard({ promo }: { promo: Promotion }) {
  const meta = TYPE_META[promo.type] ?? TYPE_META.bonus!;
  const progress = Math.min(1, promo.current_count / promo.target_count);
  const isCompleted = promo.status === 'completed';

  return (
    <Card padding={14}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 24, flexShrink: 0 }}>{meta.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: colors.navy }}>{promo.title}</span>
            {isCompleted && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: colors.success,
                background: colors.successBg, padding: '2px 8px',
                borderRadius: borderRadius.full, textTransform: 'uppercase',
              }}>
                ✓ Complete
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>{promo.description}</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: colors.success }}>
            {formatCurrency(promo.reward_amount)}
          </div>
          <div style={{ fontSize: 10, color: colors.textMuted }}>reward</div>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 11, color: colors.textMuted }}>
            {promo.current_count} / {promo.target_count} rides
          </span>
          <span style={{ fontSize: 11, fontWeight: 600, color: isCompleted ? colors.success : meta.color }}>
            {(progress * 100).toFixed(0)}%
          </span>
        </div>
        <div style={{ height: 6, background: colors.bgSecondary, borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${(progress * 100).toFixed(0)}%`,
            background: isCompleted ? colors.success : meta.color,
            borderRadius: 3, transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {promo.ends_at && !isCompleted && (
        <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 8 }}>
          Ends {formatDate(promo.ends_at)}
        </div>
      )}
      {isCompleted && promo.completed_at && (
        <div style={{ fontSize: 11, color: colors.success, marginTop: 8 }}>
          Completed {formatDate(promo.completed_at)}
        </div>
      )}
    </Card>
  );
}
