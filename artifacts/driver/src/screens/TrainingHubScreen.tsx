// ============================================================
// MCC Driver — Training Hub Screen
// ============================================================

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Car, GraduationCap, Home, Lock, ShieldAlert, TrendingUp, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/services/supabase/client';
import { PageHeader, Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { apiUrl } from '@/services/api/baseUrl';

interface TrainingModule {
  id: string;
  slug: string;
  title: string;
  description: string;
  tier_required: number;
  sort_order: number;
  estimated_minutes: number;
  totalLessons: number;
  completedLessons: number;
  percentComplete: number;
  isCertified: boolean;
  certifiedAt: string | null;
}

type LucideIcon = React.ComponentType<{ size: number; color: string; strokeWidth: number }>;
const MODULE_ICONS: Record<string, LucideIcon> = {
  'platform-basics':      Home,
  'passenger-rides':      Users,
  'solo-vehicle-shuttle': Car,
  'tandem-concierge':     GraduationCap,
  'safety-emergency':     ShieldAlert,
  'earnings-business':    TrendingUp,
};

// prerequisite chain: which slug must be certified before this tier is unlocked
const PREREQ_CHAIN: Record<number, string> = {
  1: 'platform-basics',
  2: 'passenger-rides',
  3: 'solo-vehicle-shuttle',
};

export function TrainingHubScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!driver) return;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(apiUrl('/training/modules'), {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          const j = await res.json() as { modules: TrainingModule[] };
          setModules(j.modules);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [driver?.id]);

  const certifiedSlugs = new Set(modules.filter((m) => m.isCertified).map((m) => m.slug));

  const isUnlocked = (m: TrainingModule): boolean => {
    if (m.tier_required === 0) return true;
    const prereqSlug = PREREQ_CHAIN[m.tier_required];
    return prereqSlug ? certifiedSlugs.has(prereqSlug) : true;
  };

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Training" onBack={() => navigate('/home')} />

      <div style={{ padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 20, lineHeight: 1.5 }}>
              Complete training modules to unlock higher-tier jobs and earn certifications. Platform Basics and Safety modules are always available.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {modules.map((m) => {
                const unlocked = isUnlocked(m);
                const prereqSlug = PREREQ_CHAIN[m.tier_required];
                const prereqTitle = modules.find((x) => x.slug === prereqSlug)?.title;

                return (
                  <button
                    key={m.id}
                    onClick={() => unlocked && navigate(`/training/module/${m.slug}`)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      background: 'none', border: 'none', padding: 0,
                      cursor: unlocked ? 'pointer' : 'default',
                    }}
                  >
                    <Card
                      padding={16}
                      style={{
                        opacity: unlocked ? 1 : 0.65,
                        border: m.isCertified
                          ? `1.5px solid ${colors.gold}`
                          : `1px solid ${colors.border}`,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{
                          width: 48, height: 48, borderRadius: borderRadius.md, flexShrink: 0,
                          background: unlocked ? colors.surfaceDark : colors.bgSecondary,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {unlocked
                            ? (() => { const Icon = MODULE_ICONS[m.slug] ?? BookOpen; return <Icon size={22} color={colors.gold} strokeWidth={1.5} />; })()
                            : <Lock size={20} color={colors.textMuted} strokeWidth={1.5} />}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: colors.navy }}>{m.title}</span>
                            {m.isCertified && (
                              <span style={{
                                fontSize: 10, fontWeight: 700, color: colors.gold,
                                background: `rgba(201,152,46,0.15)`, padding: '2px 8px',
                                borderRadius: borderRadius.full, textTransform: 'uppercase',
                              }}>✓ Certified</span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 8, lineHeight: 1.4 }}>
                            {unlocked ? m.description : prereqTitle
                              ? `Complete "${prereqTitle}" first to unlock`
                              : 'Prerequisites required'}
                          </div>

                          {unlocked && m.totalLessons > 0 && (
                            <>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                                <span style={{ fontSize: 11, color: colors.textMuted }}>
                                  {m.completedLessons} / {m.totalLessons} lessons
                                </span>
                                <span style={{ fontSize: 11, fontWeight: 600, color: m.isCertified ? colors.success : colors.navy }}>
                                  {m.percentComplete}%
                                </span>
                              </div>
                              <div style={{ height: 5, background: colors.bgSecondary, borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{
                                  height: '100%', width: `${m.percentComplete}%`,
                                  background: m.isCertified ? colors.gold : colors.navy,
                                  borderRadius: 3, transition: 'width 0.4s',
                                }} />
                              </div>
                            </>
                          )}

                          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 8 }}>
                            ~{m.estimated_minutes} min
                            {m.tier_required > 0 && (
                              <span style={{ marginLeft: 8, color: colors.warning }}>
                                · Tier {m.tier_required} required
                              </span>
                            )}
                          </div>
                        </div>
                        {unlocked && !m.isCertified && m.totalLessons > 0 && (
                          <div style={{ fontSize: 18, color: colors.textMuted, flexShrink: 0, alignSelf: 'center' }}>›</div>
                        )}
                      </div>
                    </Card>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
