import { useCallback, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

function readInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'dark';
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'light' ? 'light' : 'dark';
}

function applyTheme(next: Theme) {
  const html = document.documentElement;
  html.classList.add('theme-transition');
  html.setAttribute('data-theme', next);
  try {
    localStorage.setItem('theme', next);
  } catch {
  }
  window.setTimeout(() => html.classList.remove('theme-transition'), 350);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <button
      type="button"
      className="header-theme-toggle"
      id="theme-toggle"
      aria-label={theme === 'dark' ? 'Switch to day theme' : 'Switch to night theme'}
      onClick={toggle}
    >
      <span className="theme-icon-sun" aria-hidden="true">☀️</span>
      <span className="theme-icon-moon" aria-hidden="true">🌙</span>
      <span className="theme-label-dark">Night</span>
      <span className="theme-label-light">Day</span>
    </button>
  );
}
