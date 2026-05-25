// ============================================================
// MCC Driver — Reusable UI Components
// ============================================================
// These primitives emit MCC platform classes (`.btn`, `.card`,
// `.form-input`) from `public/css/driver-tokens.css` so the
// driver app visually matches the main platform. See
// `docs/driver-app-style-guide.md`.
// ============================================================

import React, { useState, useEffect } from 'react';
import { colors, borderRadius, shadows } from '@/theme';

export { MapView } from './MapView';
export type { MapViewProps, LatLng } from './MapView';
export { TransportEstimateCard } from './TransportEstimateCard';

// ============================================================
// BUTTON — wraps `.btn` + variant class from platform tokens
// ============================================================

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  // Variants map 1:1 to the platform `.btn-*` classes so this
  // wrapper stays a thin shim over the design tokens. Use
  // `gold` for the brand/premium CTA (.btn-gold).
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'gold';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: React.CSSProperties;
  type?: 'button' | 'submit' | 'reset';
  // Optional accessible name override — required when `children`
  // is only an icon/emoji (e.g. "×", "←") so VoiceOver announces
  // a verb instead of "button". For regular text buttons leave
  // unset; the visible label is the accessible name.
  ariaLabel?: string;
  // Optional ref forwarded to the underlying <button>. Used by
  // dialogs / modals that need to programmatically move focus
  // to a primary action on mount.
  buttonRef?: React.Ref<HTMLButtonElement>;
}

export function Button({
  children, onClick, variant = 'primary', size = 'md',
  disabled = false, loading = false, fullWidth = false, style, type = 'button',
  ariaLabel, buttonRef,
}: ButtonProps) {
  const variantClass = `btn-${variant}`;
  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';
  const className = ['btn', variantClass, sizeClass].filter(Boolean).join(' ');

  return (
    <button
      ref={buttonRef}
      type={type}
      onClick={disabled || loading ? undefined : onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      className={className}
      style={{
        justifyContent: 'center',
        width: fullWidth ? '100%' : undefined,
        // Minimum 44pt touch target (Apple HIG / WCAG 2.5.5) for
        // primary CTAs. `btn-sm` opts out — used for inline
        // ghost actions next to text where 44pt would dominate
        // the layout.
        minHeight: size === 'sm' ? undefined : size === 'lg' ? 56 : 44,
        ...style,
      }}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 18} /> : null}
      {children}
    </button>
  );
}

// ============================================================
// CARD — wraps `.card` from platform tokens
// ============================================================

interface CardProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  onClick?: () => void;
  padding?: number;
}

export function Card({ children, style, onClick, padding = 16 }: CardProps) {
  // When the card is interactive (`onClick` present) we render a
  // real `<button>` so it is keyboard-focusable, Enter/Space
  // activatable, and announced as a button by VoiceOver. Without
  // this, a clickable `<div>` is invisible to screen readers and
  // keyboard users.
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="card"
        style={{
          padding,
          marginBottom: 0,
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          font: 'inherit',
          color: 'inherit',
          ...style,
        }}
      >
        {children}
      </button>
    );
  }
  return (
    <div className="card" style={{ padding, marginBottom: 0, ...style }}>
      {children}
    </div>
  );
}

// ============================================================
// ONLINE TOGGLE
// ============================================================

interface OnlineToggleProps {
  isOnline: boolean;
  isToggling: boolean;
  onToggle: () => void;
  disabledReason?: string;
}

export function OnlineToggle({ isOnline, isToggling, onToggle, disabledReason }: OnlineToggleProps) {
  const isDisabled = isToggling || !!disabledReason;
  return (
    <button
      onClick={disabledReason ? undefined : onToggle}
      disabled={isDisabled}
      title={disabledReason}
      role="switch"
      aria-checked={isOnline}
      aria-busy={isToggling || undefined}
      aria-disabled={isDisabled || undefined}
      aria-label={disabledReason ?? (isOnline ? 'Go offline — stop accepting rides' : 'Go online — start accepting rides')}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 24px', borderRadius: borderRadius.xl,
        border: 'none',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        background: disabledReason ? 'var(--bg-elevated)' : isOnline ? colors.success : 'var(--bg-elevated)',
        color: isDisabled ? colors.textMuted : isOnline ? '#fff' : colors.textMuted,
        fontSize: 16, fontWeight: 600, width: '100%',
        minHeight: 48,
        opacity: disabledReason ? 0.6 : 1,
        transition: 'all 0.3s ease',
        boxShadow: isOnline && !disabledReason ? '0 4px 16px rgba(34, 197, 94, 0.3)' : shadows.sm,
        fontFamily: 'inherit',
      }}
    >
      <div style={{
        width: 12, height: 12, borderRadius: '50%',
        background: isOnline && !disabledReason ? '#fff' : colors.textMuted,
        boxShadow: isOnline && !disabledReason ? '0 0 8px rgba(255,255,255,0.5)' : 'none',
        transition: 'all 0.3s',
      }} />
      {isToggling ? 'Updating...' : disabledReason ? 'Go Online (Unavailable)' : isOnline ? 'Online — Accepting Rides' : 'Offline — Tap to Go Online'}
    </button>
  );
}

// ============================================================
// COUNTDOWN TIMER
// ============================================================

interface CountdownTimerProps {
  deadline: string;
  onExpired: () => void;
  size?: number;
}

export function CountdownTimer({ deadline, onExpired, size = 80 }: CountdownTimerProps) {
  const [seconds, setSeconds] = useState(() => {
    return Math.max(0, Math.floor((new Date(deadline).getTime() - Date.now()) / 1000));
  });
  // A separate "announce" value so the aria-live region only
  // updates at a polite cadence (every 5s, plus the urgent
  // last-10s countdown). Announcing every 100ms would spam
  // VoiceOver and drown out everything else on the modal.
  const [announce, setAnnounce] = useState<string>('');

  useEffect(() => {
    // 250 ms keeps the ring animation visually smooth (the SVG
    // transition handles in-between frames) while drastically
    // reducing render/battery cost vs. a 100 ms interval. State
    // only re-renders when the floored second changes.
    let lastSecond = -1;
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(deadline).getTime() - Date.now()) / 1000));
      if (remaining !== lastSecond) {
        lastSecond = remaining;
        setSeconds(remaining);
        if (remaining <= 10) {
          setAnnounce(`${remaining} second${remaining === 1 ? '' : 's'} left`);
        } else if (remaining > 0 && remaining % 5 === 0) {
          setAnnounce(`${remaining} seconds left to respond`);
        }
      }
      if (remaining <= 0) {
        clearInterval(interval);
        onExpired();
      }
    };
    const interval = setInterval(tick, 250);
    tick();
    return () => clearInterval(interval);
  }, [deadline, onExpired]);

  const progress = seconds / 60; // 0 to 1
  const circumference = 2 * Math.PI * (size / 2 - 4);
  const strokeDashoffset = circumference * (1 - progress);
  const urgentColor = seconds <= 10 ? colors.error : seconds <= 20 ? colors.warning : colors.gold;

  return (
    <div
      style={{ position: 'relative', width: size, height: size }}
      role="timer"
      aria-label={`Time to respond: ${seconds} seconds remaining`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {/* Background circle */}
        <circle
          cx={size / 2} cy={size / 2} r={size / 2 - 4}
          fill="none" stroke={colors.bgSecondary} strokeWidth={4}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2} cy={size / 2} r={size / 2 - 4}
          fill="none" stroke={urgentColor} strokeWidth={4}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.1s linear, stroke 0.3s' }}
        />
      </svg>
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.35, fontWeight: 700, color: urgentColor,
          fontFamily: 'monospace',
        }}
      >
        {seconds}
      </div>
      {/* Polite live region — SR-only. */}
      <span
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
          overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
        }}
      >
        {announce}
      </span>
    </div>
  );
}

// ============================================================
// STAT CARD (for earnings dashboard) — wraps `.card`
// ============================================================

interface StatCardProps {
  label: string;
  value: string;
  sublabel?: string;
  color?: string;
}

export function StatCard({ label, value, sublabel, color = colors.textPrimary }: StatCardProps) {
  return (
    <div
      className="card"
      style={{
        padding: '14px 16px',
        marginBottom: 0,
        flex: 1,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      {sublabel && (
        <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{sublabel}</div>
      )}
    </div>
  );
}

// ============================================================
// RIDE INFO ROW
// ============================================================

interface InfoRowProps {
  icon: string;
  label: string;
  value: string;
  valueColor?: string;
}

export function InfoRow({ icon, label, value, valueColor }: InfoRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
      {/* Decorative emoji — VoiceOver should skip and announce
          the label + value as a single phrase. */}
      <span aria-hidden="true" style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{icon}</span>
      <span style={{ fontSize: 13, color: colors.textMuted, flex: 1 }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: valueColor || colors.textPrimary }}>{value}</span>
    </div>
  );
}

// ============================================================
// SPINNER
// ============================================================

interface SpinnerProps {
  size?: number;
  color?: string;
}

export function Spinner({ size = 24, color = 'currentColor' }: SpinnerProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="3" strokeDasharray="32" strokeLinecap="round" opacity="0.3" />
      <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="3" strokeDasharray="32" strokeDashoffset="24" strokeLinecap="round" />
    </svg>
  );
}

// ============================================================
// PAGE HEADER — uses `colors.surfaceDark` brand navy
// ============================================================

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
}

export function PageHeader({ title, subtitle, onBack, rightAction }: PageHeaderProps) {
  return (
    <header
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px', background: colors.surfaceDark,
      }}
    >
      {onBack ? (
        <button
          onClick={onBack}
          aria-label="Go back"
          style={{
            background: 'none', border: 'none', color: colors.textWhite,
            fontSize: 22, cursor: 'pointer',
            // 44×44 touch target (Apple HIG / WCAG 2.5.5).
            minWidth: 44, minHeight: 44,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: 4, borderRadius: 8,
          }}
        >
          <span aria-hidden="true">←</span>
        </button>
      ) : (
        <img
          src="/driver/mcc-driver-logo.png"
          alt=""
          aria-hidden="true"
          style={{ width: 36, height: 36, objectFit: 'contain', flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1 }}>
        <h1 className="heading-editorial heading-editorial-md on-dark" style={{ fontWeight: 600 }}>{title}</h1>
        {subtitle && <div style={{ fontSize: 12, color: colors.gold, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {rightAction}
    </header>
  );
}

// ============================================================
// INPUT — wraps `.form-label` + `.form-input`
// ============================================================

interface InputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  error?: string;
}

export function Input({ label, value, onChange, type = 'text', placeholder, required, error }: InputProps) {
  // Stable cross-render id wires <label htmlFor> ↔ <input id> and
  // the error message's aria-describedby. Without this, VoiceOver
  // reads the field as "edit text" with no label.
  const reactId = React.useId();
  const id = `mcc-input-${reactId}`;
  const errorId = `${id}-error`;
  return (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={id} className="form-label">
        {label}
        {required && (
          <>
            <span aria-hidden="true" style={{ color: colors.error }}> *</span>
            <span style={{
              position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
              overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
            }}>
              (required)
            </span>
          </>
        )}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="form-input"
        style={error ? { borderColor: colors.error, minHeight: 44 } : { minHeight: 44 }}
      />
      {error && (
        <div id={errorId} role="alert" style={{ fontSize: 12, color: colors.error, marginTop: 4 }}>
          {error}
        </div>
      )}
    </div>
  );
}
