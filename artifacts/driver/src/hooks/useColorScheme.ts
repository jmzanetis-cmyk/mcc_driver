import { useEffect } from 'react';

// Applies the system prefers-color-scheme as the initial data-theme value.
// A manual selection by ThemeToggle (written to localStorage) takes priority
// and suppresses further system overrides for the remainder of the session.
export function useColorScheme(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hasManualPref = () => {
      try { return !!localStorage.getItem('theme'); } catch { return false; }
    };

    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      if (hasManualPref()) return;
      document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
    };

    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
}
