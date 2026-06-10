import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('boom');
  return <div>stable</div>;
}

afterEach(() => vi.restoreAllMocks());

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(<ErrorBoundary><Bomb shouldThrow={false} /></ErrorBoundary>);
    expect(screen.getByText('stable')).toBeTruthy();
  });

  it('shows the friendly error screen when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Bomb shouldThrow={true} /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeTruthy();
  });

  it('resets error state when Try Again is clicked', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Use a mutable flag: flip it before clicking retry so the re-render
    // triggered by setState doesn't immediately re-crash the boundary.
    let throwing = true;
    function ConditionalBomb() {
      if (throwing) throw new Error('boom');
      return <div>stable</div>;
    }
    render(<ErrorBoundary><ConditionalBomb /></ErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    throwing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(screen.getByText('stable')).toBeTruthy();
  });
});
