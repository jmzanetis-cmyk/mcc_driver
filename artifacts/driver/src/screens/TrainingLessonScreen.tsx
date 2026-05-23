// ============================================================
// MCC Driver — Training Lesson Screen
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/services/supabase/client';
import { Card, Button, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { apiUrl } from '@/services/api/baseUrl';

// ── Content block types ───────────────────────────────────────────────────────
interface TextBlock    { type: 'text';     heading?: string; body: string }
interface TipBlock     { type: 'tip';      text: string }
interface WarningBlock { type: 'warning';  text: string }
interface ImportantBlock { type: 'important'; text: string }
interface StepBlock    { type: 'step';     number: number; title: string; description: string }
interface ScenarioBlock { type: 'scenario'; text: string }

type ContentBlock = TextBlock | TipBlock | WarningBlock | ImportantBlock | StepBlock | ScenarioBlock;

interface Question {
  id: string;
  question_text: string;
  question_type: 'multiple_choice' | 'true_false' | 'scenario';
  options: Array<{ key: string; text: string }>;
  correct_answer: string;
  explanation: string;
  sort_order: number;
}

interface LessonData {
  id: string;
  slug: string;
  title: string;
  content_type: string;
  content: ContentBlock[];
  module_id: string;
}

// ── Content block renderers ───────────────────────────────────────────────────

function ContentBlockView({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'text':
      return (
        <div style={{ marginBottom: 16 }}>
          {block.heading && (
            <div style={{ fontSize: 16, fontWeight: 700, color: colors.navy, marginBottom: 8 }}>
              {block.heading}
            </div>
          )}
          <div style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 1.65 }}>
            {block.body}
          </div>
        </div>
      );

    case 'tip':
      return (
        <div style={{
          padding: '12px 14px', borderRadius: borderRadius.md, marginBottom: 14,
          background: 'rgba(201,152,46,0.08)', borderLeft: `3px solid ${colors.gold}`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.gold, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            💡 Tip
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.55 }}>{block.text}</div>
        </div>
      );

    case 'warning':
      return (
        <div style={{
          padding: '12px 14px', borderRadius: borderRadius.md, marginBottom: 14,
          background: colors.warningBg, borderLeft: `3px solid ${colors.warning}`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.warning, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            ⚠️ Warning
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.55 }}>{block.text}</div>
        </div>
      );

    case 'important':
      return (
        <div style={{
          padding: '12px 14px', borderRadius: borderRadius.md, marginBottom: 14,
          background: 'rgba(11,29,58,0.06)', borderLeft: `3px solid ${colors.navy}`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.navy, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            📌 Important
          </div>
          <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.55 }}>{block.text}</div>
        </div>
      );

    case 'step':
      return (
        <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
            background: colors.surfaceDark, color: colors.gold,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700,
          }}>
            {block.number}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.navy, marginBottom: 4 }}>{block.title}</div>
            <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.55 }}>{block.description}</div>
          </div>
        </div>
      );

    case 'scenario':
      return (
        <div style={{
          padding: '14px 16px', borderRadius: borderRadius.md, marginBottom: 14,
          background: 'rgba(11,29,58,0.04)', border: `1px dashed ${colors.border}`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.navy, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            📋 Scenario
          </div>
          <div style={{ fontSize: 14, color: colors.navy, lineHeight: 1.6, fontStyle: 'italic' }}>{block.text}</div>
        </div>
      );

    default:
      return null;
  }
}

// ── Question component ────────────────────────────────────────────────────────

function QuestionView({
  question, index, answer, onAnswer,
}: {
  question: Question;
  index: number;
  answer: string | null;
  onAnswer: (qId: string, key: string) => void;
}) {
  const isAnswered = answer !== null;
  const isCorrect = isAnswered && answer === question.correct_answer;

  const options: Array<{ key: string; text: string }> =
    question.question_type === 'true_false'
      ? [{ key: 'true', text: 'True' }, { key: 'false', text: 'False' }]
      : question.options;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
        Question {index + 1}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: colors.navy, marginBottom: 14, lineHeight: 1.5 }}>
        {question.question_text}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((opt) => {
          const selected = answer === opt.key;
          const correct = opt.key === question.correct_answer;
          let bg = colors.bgSecondary;
          let border = colors.border;
          let textColor = colors.navy;
          if (isAnswered) {
            if (correct) { bg = colors.successBg; border = colors.success; textColor = colors.success; }
            else if (selected && !correct) { bg = colors.errorBg; border = colors.error; textColor = colors.error; }
          } else if (selected) {
            bg = 'rgba(201,152,46,0.1)'; border = colors.gold;
          }

          return (
            <button
              key={opt.key}
              onClick={() => !isAnswered && onAnswer(question.id, opt.key)}
              disabled={isAnswered}
              style={{
                minHeight: 52, padding: '12px 16px',
                border: `1.5px solid ${border}`,
                borderRadius: borderRadius.md, background: bg,
                cursor: isAnswered ? 'default' : 'pointer',
                textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                fontFamily: 'inherit', transition: 'all 0.15s',
              }}
            >
              <span style={{
                width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                background: isAnswered && correct ? colors.success : isAnswered && selected && !correct ? colors.error : colors.bgSecondary,
                border: `1.5px solid ${border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: isAnswered && (correct || (selected && !correct)) ? '#fff' : colors.textMuted,
              }}>
                {isAnswered && correct ? '✓' : isAnswered && selected && !correct ? '✗' : opt.key.toUpperCase()}
              </span>
              <span style={{ fontSize: 14, color: textColor, fontWeight: selected || correct ? 600 : 400 }}>
                {opt.text}
              </span>
            </button>
          );
        })}
      </div>
      {isAnswered && (
        <div style={{
          marginTop: 10, padding: '10px 14px', borderRadius: borderRadius.sm,
          background: isCorrect ? colors.successBg : colors.errorBg,
          border: `1px solid ${isCorrect ? colors.success : colors.error}`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: isCorrect ? colors.success : colors.error, marginBottom: 4 }}>
            {isCorrect ? '✓ Correct!' : '✗ Incorrect'}
          </div>
          <div style={{ fontSize: 12, color: colors.textSecondary, lineHeight: 1.5 }}>
            {question.explanation}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export function TrainingLessonScreen() {
  const navigate = useNavigate();
  const { lessonId } = useParams<{ lessonId: string }>();
  const { driver } = useAuth();

  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);

  // Content step progression
  const [contentStep, setContentStep] = useState(0);
  const [showQuiz, setShowQuiz] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [result, setResult] = useState<{ score: number; correct: number; total: number; passed: boolean; certified: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!driver || !lessonId) return;
    void (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(apiUrl(`/training/lessons/${lessonId}`), {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.ok) {
        const j = await res.json() as { lesson: LessonData; questions: Question[] };
        setLesson(j.lesson);
        setQuestions(j.questions);
      }
      setLoading(false);
    })();
  }, [driver?.id, lessonId]);

  const handleAnswer = useCallback((qId: string, key: string) => {
    setAnswers((prev) => ({ ...prev, [qId]: key }));
  }, []);

  const allAnswered = questions.length > 0 && questions.every((q) => answers[q.id] !== undefined);

  const handleSubmitQuiz = async () => {
    if (!lessonId || !allAnswered) return;
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(apiUrl(`/training/lessons/${lessonId}/complete`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ answers }),
      });
      if (res.ok) {
        const j = await res.json() as { score: number; correct: number; total: number; passed: boolean; certified: boolean };
        setResult(j);
        setQuizSubmitted(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !lesson) {
    return (
      <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Spinner />
      </div>
    );
  }

  const content = lesson.content as ContentBlock[];
  const totalSteps = content.length;
  const currentBlock = content[contentStep];
  const isLastContentStep = contentStep >= totalSteps - 1;

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        background: colors.surfaceDark, padding: '16px 20px',
        paddingTop: 'max(16px, env(safe-area-inset-top))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: '50%',
              width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, color: '#fff', cursor: 'pointer',
            }}
          >
            ←
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {showQuiz ? 'Knowledge Check' : `Step ${contentStep + 1} of ${totalSteps}`}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginTop: 2 }}>{lesson.title}</div>
          </div>
        </div>
        {/* Progress bar */}
        {!showQuiz && (
          <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', borderRadius: 2, marginTop: 12, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2, background: colors.gold, transition: 'width 0.3s',
              width: `${((contentStep + 1) / totalSteps) * 100}%`,
            }} />
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
        {!showQuiz ? (
          <>
            {currentBlock && <ContentBlockView block={currentBlock} />}
            <div style={{ marginTop: 24 }}>
              {isLastContentStep ? (
                questions.length > 0 ? (
                  <Button onClick={() => setShowQuiz(true)} variant="primary" fullWidth size="lg">
                    Take Knowledge Check →
                  </Button>
                ) : (
                  <Button onClick={() => navigate(-1)} variant="success" fullWidth size="lg">
                    Complete Lesson ✓
                  </Button>
                )
              ) : (
                <Button onClick={() => setContentStep((s) => s + 1)} variant="primary" fullWidth size="lg">
                  Next →
                </Button>
              )}
              {contentStep > 0 && (
                <button
                  onClick={() => setContentStep((s) => s - 1)}
                  style={{
                    marginTop: 10, width: '100%', padding: '10px 0',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontSize: 13, color: colors.textMuted, fontFamily: 'inherit',
                  }}
                >
                  ← Back
                </button>
              )}
            </div>
          </>
        ) : quizSubmitted && result ? (
          // Results screen
          <div>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 56, marginBottom: 12 }}>{result.passed ? '🎉' : '📚'}</div>
              <div className="heading-editorial heading-editorial-lg" style={{ marginBottom: 8 }}>
                {result.passed ? 'Nice work!' : 'Keep learning'}
              </div>
              <div style={{ fontSize: 14, color: colors.textMuted, marginBottom: 16 }}>
                You got {result.correct} of {result.total} correct — {result.score}%
              </div>
              <div style={{
                display: 'inline-block', padding: '10px 24px', borderRadius: borderRadius.full,
                background: result.passed ? colors.successBg : colors.errorBg,
                color: result.passed ? colors.success : colors.error,
                fontSize: 15, fontWeight: 700,
              }}>
                {result.passed ? '✓ Lesson Passed' : '✗ Below 80% — Review Required'}
              </div>
              {result.certified && (
                <div style={{
                  marginTop: 16, padding: '14px 20px', borderRadius: borderRadius.md,
                  background: 'rgba(201,152,46,0.1)', border: `1px solid ${colors.gold}`,
                }}>
                  <div style={{ fontSize: 18, marginBottom: 4 }}>🎓</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: colors.gold }}>
                    Module Certified!
                  </div>
                  <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                    You've completed all lessons and earned this certification.
                  </div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {result.passed ? (
                <Button onClick={() => navigate(-1)} variant="primary" fullWidth>
                  Back to Module
                </Button>
              ) : (
                <>
                  <Button
                    onClick={() => {
                      setShowQuiz(false);
                      setContentStep(0);
                      setAnswers({});
                      setQuizSubmitted(false);
                      setResult(null);
                    }}
                    variant="primary"
                    fullWidth
                  >
                    Review & Try Again
                  </Button>
                  <Button onClick={() => navigate(-1)} variant="ghost" fullWidth>
                    Back to Module
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (
          // Quiz
          <div>
            {questions.map((q, i) => (
              <QuestionView
                key={q.id}
                question={q}
                index={i}
                answer={answers[q.id] ?? null}
                onAnswer={handleAnswer}
              />
            ))}
            <Button
              onClick={() => { void handleSubmitQuiz(); }}
              disabled={!allAnswered || submitting}
              loading={submitting}
              variant="primary"
              fullWidth
              size="lg"
            >
              Submit Answers
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
