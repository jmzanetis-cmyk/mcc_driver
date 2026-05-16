import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { colors } from '@/theme';

interface LegalLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function LegalLayout({ title, subtitle, children }: LegalLayoutProps) {
  const navigate = useNavigate();
  return (
    <div style={{ minHeight: '100vh', background: colors.bgPrimary, color: colors.textPrimary }}>
      <header style={{
        padding: '16px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surfaceDark, color: '#fff',
      }}>
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          style={{
            background: 'transparent', border: 'none', color: colors.gold,
            fontSize: 24, cursor: 'pointer', padding: 4, lineHeight: 1,
          }}
        >
          ←
        </button>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px 80px' }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: colors.navy, marginBottom: 4 }}>{title}</h1>
        {subtitle && (
          <div style={{ fontSize: 13, color: colors.textMuted, marginBottom: 24 }}>{subtitle}</div>
        )}
        <article
          style={{
            fontSize: 15, lineHeight: 1.7, color: colors.textPrimary,
          }}
          className="legal-content"
        >
          {children}
        </article>

        <nav style={{
          marginTop: 48, paddingTop: 20,
          borderTop: `1px solid ${colors.border}`,
          display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center',
          fontSize: 13,
        }}>
          <Link to="/legal/privacy" style={{ color: colors.gold }}>Privacy Policy</Link>
          <Link to="/legal/terms" style={{ color: colors.gold }}>Terms of Service</Link>
          <Link to="/legal/support" style={{ color: colors.gold }}>Support</Link>
        </nav>
      </main>

      <style>{`
        .legal-content h2 { font-size: 18px; font-weight: 700; color: ${colors.navy}; margin: 28px 0 10px; }
        .legal-content h3 { font-size: 15px; font-weight: 600; color: ${colors.navy}; margin: 20px 0 8px; }
        .legal-content p { margin: 0 0 12px; }
        .legal-content ul { margin: 0 0 14px 20px; padding: 0; }
        .legal-content li { margin: 0 0 6px; }
        .legal-content table { width: 100%; border-collapse: collapse; margin: 12px 0 18px; font-size: 13px; }
        .legal-content th, .legal-content td { text-align: left; padding: 8px 10px; border-bottom: 1px solid ${colors.border}; vertical-align: top; }
        .legal-content th { background: ${colors.bgCard}; color: ${colors.navy}; font-weight: 600; }
        .legal-content a { color: ${colors.gold}; }
      `}</style>
    </div>
  );
}
