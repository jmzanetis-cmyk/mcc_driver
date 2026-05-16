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
}

export function Button({
  children, onClick, variant = 'primary', size = 'md',
  disabled = false, loading = false, fullWidth = false, style, type = 'button',
}: ButtonProps) {
  const variantClass = `btn-${variant}`;
  const sizeClass = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';
  const className = ['btn', variantClass, sizeClass].filter(Boolean).join(' ');

  return (
    <button
      type={type}
      onClick={disabled || loading ? undefined : onClick}
      disabled={disabled || loading}
      className={className}
      style={{
        justifyContent: 'center',
        width: fullWidth ? '100%' : undefined,
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
  return (
    <div
      onClick={onClick}
      className="card"
      style={{
        padding,
        marginBottom: 0,
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
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
}

export function OnlineToggle({ isOnline, isToggling, onToggle }: OnlineToggleProps) {
  return (
    <button
      onClick={onToggle}
      disabled={isToggling}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 24px', borderRadius: borderRadius.xl,
        border: 'none', cursor: isToggling ? 'wait' : 'pointer',
        background: isOnline ? colors.success : 'var(--bg-elevated)',
        color: isOnline ? '#fff' : colors.textMuted,
        fontSize: 16, fontWeight: 600, width: '100%',
        transition: 'all 0.3s ease',
        boxShadow: isOnline ? '0 4px 16px rgba(52, 211, 153, 0.3)' : shadows.sm,
        fontFamily: 'inherit',
      }}
    >
      <div style={{
        width: 12, height: 12, borderRadius: '50%',
        background: isOnline ? '#fff' : colors.textMuted,
        boxShadow: isOnline ? '0 0 8px rgba(255,255,255,0.5)' : 'none',
        transition: 'all 0.3s',
      }} />
      {isToggling ? 'Updating...' : isOnline ? 'Online — Accepting Rides' : 'Offline — Tap to Go Online'}
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

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(deadline).getTime() - Date.now()) / 1000));
      setSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onExpired();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [deadline, onExpired]);

  const progress = seconds / 60; // 0 to 1
  const circumference = 2 * Math.PI * (size / 2 - 4);
  const strokeDashoffset = circumference * (1 - progress);
  const urgentColor = seconds <= 10 ? colors.error : seconds <= 20 ? colors.warning : colors.gold;

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
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
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.35, fontWeight: 700, color: urgentColor,
        fontFamily: 'monospace',
      }}>
        {seconds}
      </div>
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
      <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>{icon}</span>
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
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px', background: colors.surfaceDark,
    }}>
      {onBack ? (
        <button onClick={onBack} style={{
          background: 'none', border: 'none', color: colors.textWhite,
          fontSize: 22, cursor: 'pointer', padding: 4,
        }}>
          ←
        </button>
      ) : (
        <img
          src="/driver/mcc-driver-logo.png"
          alt="My Car Concierge Driver"
          style={{ width: 36, height: 36, objectFit: 'contain', flexShrink: 0 }}
        />
      )}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: colors.textWhite }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: colors.gold, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {rightAction}
    </div>
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
  return (
    <div style={{ marginBottom: 16 }}>
      <label className="form-label">
        {label}{required && <span style={{ color: colors.error }}> *</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="form-input"
        style={error ? { borderColor: colors.error } : undefined}
      />
      {error && <div style={{ fontSize: 12, color: colors.error, marginTop: 4 }}>{error}</div>}
    </div>
  );
}
