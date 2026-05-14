// ============================================================
// MCC Driver — Brand Theme
// ============================================================
// Matches MCC member app: navy/gold/cream palette
// Usage: import { colors, spacing, typography } from '@/theme';
// ============================================================

export const colors = {
  // Primary
  navy: '#0B1D3A',
  gold: '#C9982E',
  cream: '#FAF8F5',

  // Text
  textPrimary: '#1A1A2E',
  textSecondary: '#4A4A5A',
  textMuted: '#8A8578',
  textWhite: '#F7F5F0',

  // Backgrounds
  bgPrimary: '#F7F5F0',
  bgCard: '#FFFFFF',
  bgSecondary: '#F0EDE6',
  bgOverlay: 'rgba(11, 29, 58, 0.7)',

  // Borders
  border: '#E5E1D8',
  borderLight: '#F0EDE6',

  // Status
  success: '#2D8A56',
  successBg: '#E8F5E9',
  warning: '#B07015',
  warningBg: '#FFF3E0',
  error: '#C44',
  errorBg: '#FFEBEE',
  info: '#2D6B8A',
  infoBg: '#E3F2FD',

  // Driver-specific
  online: '#2D8A56',
  offline: '#8A8578',
  driverBlue: '#2D6B8A',   // Primary driver pin
  chaseGold: '#C9982E',     // Chase driver pin

  // Tag colors
  tagSetup: '#0B1D3A',
  tagScreen: '#C9982E',
  tagBackend: '#2D6B8A',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const borderRadius = {
  sm: 6,
  md: 10,
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
  sm: '0 1px 3px rgba(11, 29, 58, 0.08)',
  md: '0 4px 12px rgba(11, 29, 58, 0.1)',
  lg: '0 8px 24px rgba(11, 29, 58, 0.12)',
};
