import React from 'react';
import { borderRadius } from '@/theme';

interface Props {
  mph: number | null;
  style?: React.CSSProperties;
}

export function SpeedChip({ mph, style }: Props) {
  if (mph === null) return null;
  return (
    <div
      aria-label={`Current speed: ${Math.round(mph)} miles per hour`}
      style={{
        display: 'inline-flex', alignItems: 'baseline', gap: 3,
        background: 'var(--accent-gold)', color: '#1a1200',
        padding: '5px 12px', borderRadius: borderRadius.full,
        fontSize: 16, fontWeight: 800, fontFamily: 'monospace',
        boxShadow: '0 2px 8px rgba(201,152,46,0.45)',
        pointerEvents: 'none',
        ...style,
      }}
    >
      {Math.round(mph)}
      <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.75, letterSpacing: 0.3 }}>mph</span>
    </div>
  );
}
