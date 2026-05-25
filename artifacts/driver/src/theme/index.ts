// ============================================================
// MCC Driver — Brand Theme
// ============================================================
// As of Task #67, the JS color tokens here are rebound to the
// platform CSS custom properties defined in
// `public/css/driver-tokens.css`. That way every existing
// `style={{ background: colors.bgPrimary }}` etc. automatically
// flips with the light/dark theme toggle (no per-screen rewrite
// required). Add new screens using the same tokens or, even
// better, the platform classes (`.btn .btn-gold`, `.card`,
// `.form-input`) directly.
//
// One exception: `colors.surfaceDark` is a fixed brand navy used
// by header bars / hero panels that should remain dark even in
// light mode (matches the main platform's editorial hero look).
// ============================================================

export const colors = {
  // Primary brand
  navy: 'var(--text-primary)',          // text uses — themed
  surfaceDark: '#1B2A4A',                // fixed brand navy for header/hero surfaces
  gold: 'var(--accent-gold)',
  cream: '#FAF7F0',

  // Text
  textPrimary: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textMuted: 'var(--text-muted)',
  textWhite: '#FAF7F0',

  // Backgrounds
  bgPrimary: 'var(--bg-deep)',
  bgCard: 'var(--bg-card)',
  bgSecondary: 'var(--bg-input)',
  bgOverlay: 'rgba(0, 0, 0, 0.6)',

  // Borders
  border: 'var(--border-subtle)',
  borderLight: 'var(--border-subtle)',

  // Status
  success: 'var(--accent-green)',
  successBg: 'var(--accent-green-soft)',
  warning: 'var(--accent-orange)',
  warningBg: 'var(--accent-orange-soft)',
  error: 'var(--accent-red)',
  errorBg: 'var(--accent-red-soft)',
  info: 'var(--accent-blue)',
  infoBg: 'var(--accent-blue-soft)',

  // Driver-specific (legacy, used in chart/pin components)
  online: 'var(--accent-green)',
  offline: 'var(--text-muted)',
  driverBlue: 'var(--accent-blue)',
  chaseGold: 'var(--accent-gold)',

  // Tag colors (legacy — not theme-critical)
  tagSetup: '#1B2A4A',
  tagScreen: '#C9982E',
  tagBackend: '#2D6B8A',
};

// `colors.X` values are now CSS-variable strings, so the previous
// pattern `${colors.success}30` (concatenating a hex alpha) silently
// produces invalid CSS. Use `withAlpha(colors.success, '30')` instead;
// it converts the hex-alpha byte to a percent and emits a
// `color-mix(...)` expression that renders the same translucent fill.
export function withAlpha(token: string, alphaHex: string): string {
  const byte = parseInt(alphaHex, 16);
  const pct = Number.isFinite(byte) ? Math.round((byte / 255) * 100) : 0;
  return `color-mix(in srgb, ${token} ${pct}%, transparent)`;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 1.2 },
  h2: { fontSize: 22, fontWeight: '600' as const, lineHeight: 1.3 },
  h3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 1.3 },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 1.5 },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, lineHeight: 1.5 },
  caption: { fontSize: 11, fontWeight: '500' as const, lineHeight: 1.4 },
  label: { fontSize: 12, fontWeight: '600' as const, lineHeight: 1.3, letterSpacing: 0.5, textTransform: 'uppercase' as const },
  button: { fontSize: 15, fontWeight: '600' as const, lineHeight: 1 },
  mono: { fontSize: 32, fontWeight: '700' as const, fontFamily: 'monospace' },
};

export const shadows = {
  sm: 'var(--shadow-sm)',
  md: 'var(--shadow-md)',
  lg: 'var(--shadow-lg)',
};
