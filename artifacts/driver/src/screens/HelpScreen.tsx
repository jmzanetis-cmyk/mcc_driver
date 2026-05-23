// ============================================================
// MCC Driver — Help & Support Screen
// ============================================================

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/services/supabase/client';
import { PageHeader, Card, Button, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { apiUrl } from '@/services/api/baseUrl';
import { formatDate } from '@/utils/formatters';

interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  created_at: string;
  resolved_at: string | null;
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  open:        { label: 'Open',        color: colors.info,    bg: colors.infoBg },
  in_progress: { label: 'In Progress', color: colors.warning, bg: colors.warningBg },
  resolved:    { label: 'Resolved',    color: colors.success, bg: colors.successBg },
  closed:      { label: 'Closed',      color: colors.textMuted, bg: colors.bgSecondary },
};

const FAQS: Array<{ question: string; answer: string }> = [
  {
    question: 'When will I receive my earnings?',
    answer: 'Standard payouts are processed weekly every Friday. Instant payouts (where available) arrive within 30 minutes to your linked debit card for a small fee.',
  },
  {
    question: 'How is my rating calculated?',
    answer: 'Your rating is the rolling average of all member ratings you have received. Ratings below 3 stars are reviewed by our team. Completing more rides with high ratings improves your score.',
  },
  {
    question: 'What happens if I cancel an accepted ride?',
    answer: 'Driver-initiated cancellations after acceptance lower your completion rate, which affects your standing on the platform. Three cancellations in a 30-day period may result in a temporary suspension.',
  },
  {
    question: 'How do I update my vehicle information?',
    answer: 'Vehicle updates must be submitted through your driver profile. Go to Settings → View Profile. Major changes (different vehicle) require admin approval.',
  },
  {
    question: 'My document was rejected — what do I do?',
    answer: 'Check the rejection reason in Settings → Documents. Re-upload a clearer photo or PDF. Common issues: blurry images, expired documents, or name mismatch.',
  },
  {
    question: 'How do I dispute an incorrect fare or rating?',
    answer: 'Use the support ticket form below to describe the issue, including the ride ID (visible in Earnings → Ride History). Our team reviews disputes within 2 business days.',
  },
  {
    question: 'What is the Ride-Along (Tandem) program?',
    answer: 'Certain rides require a tandem co-driver to move two vehicles simultaneously. You can pair with a Known Partner, let the platform match you, or handle both vehicles yourself (Mode C, with liability acceptance).',
  },
  {
    question: 'How do I reach emergency support during a ride?',
    answer: 'Use the red 🆘 panic button that appears on the Navigate screen during any active ride. It alerts your emergency contact and logs your GPS location.',
  },
];

export function HelpScreen() {
  const navigate = useNavigate();
  const { driver } = useAuth();
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!driver) return;
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(apiUrl('/support/tickets'), {
          headers: { Authorization: `Bearer ${session?.access_token}` },
        });
        if (res.ok) {
          const j = await res.json() as { tickets: SupportTicket[] };
          setTickets(j.tickets);
        }
      } finally {
        setTicketsLoading(false);
      }
    })();
  }, [driver?.id]);

  const handleSubmit = async () => {
    if (!subject.trim() || !description.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(apiUrl('/support/tickets'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ subject: subject.trim(), description: description.trim() }),
      });
      if (res.ok) {
        const j = await res.json() as { ticketId: string };
        setTickets((prev) => [{
          id: j.ticketId, subject: subject.trim(), description: description.trim(),
          status: 'open', created_at: new Date().toISOString(), resolved_at: null,
        }, ...prev]);
        setSubject('');
        setDescription('');
        setSubmitted(true);
        setTimeout(() => setSubmitted(false), 4000);
      } else {
        const j = await res.json() as { error?: string };
        setSubmitError(j.error ?? 'Failed to submit ticket');
      }
    } catch {
      setSubmitError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="Help & Support" onBack={() => navigate('/settings')} />

      <div style={{ padding: 20 }}>
        {/* FAQ */}
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          Frequently Asked Questions
        </div>
        <Card padding={0} style={{ marginBottom: 20 }}>
          {FAQS.map((faq, i) => (
            <div key={i} style={{ borderBottom: i < FAQS.length - 1 ? `1px solid ${colors.border}` : 'none' }}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                style={{
                  width: '100%', display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', gap: 10, padding: '14px 16px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: colors.navy, flex: 1 }}>
                  {faq.question}
                </span>
                <span style={{
                  fontSize: 16, color: colors.textMuted, flexShrink: 0,
                  transform: openFaq === i ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }}>
                  ›
                </span>
              </button>
              {openFaq === i && (
                <div style={{
                  padding: '0 16px 14px', fontSize: 13,
                  color: colors.textSecondary, lineHeight: 1.6,
                }}>
                  {faq.answer}
                </div>
              )}
            </div>
          ))}
        </Card>

        {/* Submit ticket */}
        <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
          Submit a Support Ticket
        </div>
        <Card padding={16} style={{ marginBottom: 20 }}>
          {submitted && (
            <div style={{
              padding: '10px 14px', borderRadius: borderRadius.sm,
              background: colors.successBg, color: colors.success,
              fontSize: 13, fontWeight: 600, marginBottom: 14,
            }}>
              ✓ Ticket submitted! Our team will respond within 2 business days.
            </div>
          )}
          {submitError && (
            <div style={{
              padding: '10px 14px', borderRadius: borderRadius.sm,
              background: colors.errorBg, color: colors.error,
              fontSize: 13, marginBottom: 14,
            }}>
              {submitError}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject (e.g. Incorrect payout amount)"
              maxLength={200}
              style={{
                padding: '10px 12px', borderRadius: borderRadius.sm,
                border: `1px solid ${colors.border}`, background: colors.bgSecondary,
                fontSize: 14, color: colors.navy, fontFamily: 'inherit',
              }}
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your issue in detail. Include ride IDs if relevant."
              maxLength={5000}
              rows={5}
              style={{
                padding: '10px 12px', borderRadius: borderRadius.sm,
                border: `1px solid ${colors.border}`, background: colors.bgSecondary,
                fontSize: 14, color: colors.navy, fontFamily: 'inherit',
                resize: 'none',
              }}
            />
            <div style={{ fontSize: 11, color: colors.textMuted, textAlign: 'right' }}>
              {description.length}/5000
            </div>
            <Button
              onClick={() => { void handleSubmit(); }}
              loading={submitting}
              disabled={!subject.trim() || !description.trim() || submitting}
              variant="primary"
              fullWidth
            >
              Submit Ticket
            </Button>
          </div>
        </Card>

        {/* Ticket history */}
        {ticketsLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner size={20} /></div>
        ) : tickets.length > 0 && (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
              My Tickets
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tickets.map((t) => {
                const meta = STATUS_META[t.status] ?? STATUS_META.open!;
                return (
                  <Card key={t.id} padding={14}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: colors.navy, flex: 1, marginRight: 8 }}>{t.subject}</div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: meta.color, background: meta.bg,
                        padding: '2px 8px', borderRadius: borderRadius.full, textTransform: 'uppercase', flexShrink: 0,
                      }}>
                        {meta.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: colors.textMuted }}>
                      Submitted {formatDate(t.created_at)}
                      {t.resolved_at && ` · Resolved ${formatDate(t.resolved_at)}`}
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
