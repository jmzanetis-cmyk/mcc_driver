// ============================================================
// MCC Driver — Training Module Screen
// ============================================================

import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/services/supabase/client';
import { PageHeader, Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { apiUrl } from '@/services/api/baseUrl';

interface LessonMeta {
  id: string;
  slug: string;
  title: string;
  content_type: string;
  sort_order: number;
  status: 'not_started' | 'in_progress' | 'completed';
  score: number | null;
  completedAt: string | null;
}

interface ModuleDetail {
  id: string;
  slug: string;
  title: string;
  description: string;
  tier_required: number;
  estimated_minutes: number;
}

const STATUS_ICON: Record<string, string> = {
  completed: '✅',
  in_progress: '🔄',
  not_started: '○',
};

export function TrainingModuleScreen() {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const { driver } = useAuth();
  const [module, setModule] = useState<ModuleDetail | null>(null);
  const [lessons, setLessons] = useState<LessonMeta[]>([]);
  const [totalLessons, setTotalLessons] = useState(0);
  const [completedLessons, setCompletedLessons] = useState(0);
  const [percentComplete, setPercentComplete] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!driver || !slug) return;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(apiUrl(`/training/modules/${slug}`), {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          const j = await res.json() as {
            module: ModuleDetail;
            lessons: LessonMeta[];
            totalLessons: number;
            completedLessons: number;
            percentComplete: number;
          };
          setModule(j.module);
          setLessons(j.lessons);
          setTotalLessons(j.totalLessons);
          setCompletedLessons(j.completedLessons);
          setPercentComplete(j.percentComplete);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [driver?.id, slug]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
        <PageHeader title="Module" onBack={() => navigate('/training')} />
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>
      </div>
    );
  }

  if (!module) {
    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
        <PageHeader title="Module" onBack={() => navigate('/training')} />
        <div style={{ padding: 24, textAlign: 'center', color: colors.textMuted }}>Module not found.</div>
      </div>
    );
  }

  // Find first incomplete lesson to highlight as "start here"
  const nextLesson = lessons.find((l) => l.status !== 'completed');

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title={module.title} onBack={() => navigate('/training')} />

      <div style={{ padding: 20 }}>
        {/* Progress hero */}
        <div style={{
          background: colors.surfaceDark, borderRadius: borderRadius.lg,
          padding: 20, marginBottom: 20,
        }}>
          <span className="eyebrow on-dark" style={{ marginBottom: 4, display: 'block' }}>{module.title}</span>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 16, lineHeight: 1.4 }}>
            {module.description}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
              {completedLessons} of {totalLessons} lessons complete
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: colors.gold }}>{percentComplete}%</span>
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.15)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${percentComplete}%`,
              background: colors.gold, borderRadius: 3, transition: 'width 0.4s',
            }} />
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 8 }}>
            ⏱ ~{module.estimated_minutes} min total
          </div>
        </div>

        {/* Lessons list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lessons.map((lesson, i) => {
            const isNext = lesson.id === nextLesson?.id;
            return (
              <button
                key={lesson.id}
                onClick={() => navigate(`/training/lesson/${lesson.id}`)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                }}
              >
                <Card
                  padding={14}
                  style={{
                    border: isNext
                      ? `1.5px solid ${colors.gold}`
                      : lesson.status === 'completed'
                      ? `1px solid ${colors.success}`
                      : `1px solid ${colors.border}`,
                    background: isNext ? `rgba(201,152,46,0.04)` : undefined,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                      background: lesson.status === 'completed'
                        ? colors.successBg
                        : lesson.status === 'in_progress'
                        ? colors.warningBg
                        : colors.bgSecondary,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 16,
                    }}>
                      {lesson.status === 'completed' ? '✅'
                        : lesson.status === 'in_progress' ? '🔄'
                        : <span style={{ fontSize: 13, fontWeight: 700, color: colors.textMuted }}>{i + 1}</span>}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>{lesson.title}</div>
                      <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                        {lesson.status === 'completed' && lesson.score !== null
                          ? `Score: ${lesson.score}% ✓`
                          : lesson.status === 'in_progress'
                          ? 'In progress'
                          : `Lesson ${i + 1}`}
                        {isNext && lesson.status !== 'completed' && (
                          <span style={{ marginLeft: 8, color: colors.gold, fontWeight: 600 }}>← Start here</span>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 16, color: colors.textMuted }}>›</div>
                  </div>
                </Card>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
