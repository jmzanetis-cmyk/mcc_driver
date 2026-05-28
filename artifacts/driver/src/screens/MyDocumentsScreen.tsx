// ============================================================
// MCC Driver — My Documents Screen
// ============================================================
// Shows the authenticated driver's own documents grouped by
// category.  Documents are fetched as metadata only (no paths).
// Viewing a file fetches a short-lived signed URL server-side.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/services/supabase/client';
import { PageHeader, Card, Spinner } from '@/components';
import { colors, borderRadius } from '@/theme';
import { apiUrl } from '@/services/api/baseUrl';

interface DocItem {
  id: string;
  category: string;
  label: string;
  hasFile: boolean;
  status: string;
  statusLabel: string;
}

const BGC_STATUS_COLOR: Record<string, { color: string; bg: string }> = {
  passed:      { color: colors.success, bg: colors.successBg },
  pending:     { color: colors.warning, bg: colors.warningBg },
  failed:      { color: colors.error,   bg: colors.errorBg },
  not_started: { color: colors.error,   bg: colors.errorBg },
};

export function MyDocumentsScreen() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingDoc, setOpeningDoc] = useState<string | null>(null);
  const [signedUrlError, setSignedUrlError] = useState<string | null>(null);

  const fetchDocs = useCallback(async () => {
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setError('Not signed in'); return; }
      const res = await fetch(apiUrl('/drivers/me/documents'), {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) { setError('Failed to load documents'); return; }
      const json = await res.json() as { documents: DocItem[] };
      setDocs(json.documents);
    } catch {
      setError('Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchDocs(); }, [fetchDocs]);

  const handleView = async (docId: string) => {
    setSignedUrlError(null);
    setOpeningDoc(docId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch(
        apiUrl(`/drivers/me/documents/signed-url?doc=${encodeURIComponent(docId)}`),
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (!res.ok) {
        setSignedUrlError('Could not open document. Please try again.');
        return;
      }
      const { signedUrl } = await res.json() as { signedUrl: string };
      window.open(signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setSignedUrlError('Could not open document. Please try again.');
    } finally {
      setOpeningDoc(null);
    }
  };

  const bgcDoc = docs.find((d) => d.id === 'bgc');
  const licenseDocs = docs.filter((d) => d.category === 'licenses');

  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary }}>
      <PageHeader title="My Documents" onBack={() => navigate('/settings')} />

      <div style={{ padding: 20 }}>
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spinner />
          </div>
        ) : error ? (
          <Card padding={24}>
            <div style={{ textAlign: 'center', color: colors.error }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>⚠️</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{error}</div>
            </div>
          </Card>
        ) : (
          <>
            {signedUrlError && (
              <div style={{
                marginBottom: 14, padding: '10px 14px',
                background: colors.errorBg, borderRadius: borderRadius.md,
                fontSize: 13, color: colors.error, fontWeight: 500,
              }}>
                {signedUrlError}
              </div>
            )}

            {/* Background Check */}
            {bgcDoc && (
              <>
                <SectionLabel>Background Check</SectionLabel>
                <Card padding={16} style={{ marginBottom: 20 }}>
                  <BgcRow doc={bgcDoc} />
                </Card>
              </>
            )}

            {/* Licenses & Insurance */}
            <SectionLabel>Licenses &amp; Insurance</SectionLabel>
            <Card padding={0} style={{ marginBottom: 20 }}>
              {licenseDocs.map((doc, i) => (
                <DocRow
                  key={doc.id}
                  doc={doc}
                  isLast={i === licenseDocs.length - 1}
                  loading={openingDoc === doc.id}
                  onView={() => void handleView(doc.id)}
                />
              ))}
            </Card>

            {/* Signed Agreements — coming soon */}
            <SectionLabel>Signed Agreements</SectionLabel>
            <Card padding={16} style={{ marginBottom: 20 }}>
              <ComingSoon label="Driver agreement and addenda will appear here once the document signing flow is live." />
            </Card>

            {/* Tax Documents — coming soon */}
            <SectionLabel>Tax Documents</SectionLabel>
            <Card padding={16}>
              <ComingSoon label="W-9 on file and year-end 1099-NEC forms will appear here once available." />
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, color: colors.textMuted,
      textTransform: 'uppercase', letterSpacing: 0.8,
      marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

function BgcRow({ doc }: { doc: DocItem }) {
  const cfg = BGC_STATUS_COLOR[doc.status] ?? BGC_STATUS_COLOR.not_started!;
  const icon =
    doc.status === 'passed' ? '✅' :
    doc.status === 'pending' ? '🕐' :
    doc.status === 'failed' ? '❌' : '🛡️';
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>
          Background Check
        </span>
      </div>
      <span style={{
        fontSize: 11, fontWeight: 700, padding: '3px 10px',
        borderRadius: borderRadius.full,
        color: cfg.color, background: cfg.bg,
        textTransform: 'uppercase', letterSpacing: 0.3,
      }}>
        {doc.statusLabel}
      </span>
    </div>
  );
}

function DocRow({
  doc,
  isLast,
  loading,
  onView,
}: {
  doc: DocItem;
  isLast: boolean;
  loading: boolean;
  onView: () => void;
}) {
  const uploaded = doc.hasFile;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '14px 16px',
      borderBottom: isLast ? 'none' : `1px solid ${colors.borderLight}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: colors.navy }}>
          {doc.label}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '2px 8px',
            borderRadius: borderRadius.full, textTransform: 'uppercase', letterSpacing: 0.3,
            color: uploaded ? colors.success : colors.textMuted,
            background: uploaded ? colors.successBg : colors.bgSecondary,
          }}>
            {doc.statusLabel}
          </span>
        </div>
      </div>

      {uploaded && (
        <button
          onClick={onView}
          disabled={loading}
          style={{
            padding: '7px 14px',
            background: loading ? colors.bgSecondary : colors.surfaceDark,
            border: 'none', borderRadius: borderRadius.sm, cursor: 'pointer',
            fontSize: 12, fontWeight: 600,
            color: loading ? colors.textMuted : colors.gold,
            flexShrink: 0, marginLeft: 12,
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '…' : 'View'}
        </button>
      )}
    </div>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <span style={{ fontSize: 20, flexShrink: 0, opacity: 0.4 }}>🔒</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: colors.textMuted, marginBottom: 4 }}>
          Coming Soon
        </div>
        <div style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.5 }}>
          {label}
        </div>
      </div>
    </div>
  );
}
