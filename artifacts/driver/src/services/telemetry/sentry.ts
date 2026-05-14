// ============================================================
// MCC Driver — Sentry Error Tracking
// ============================================================

import * as Sentry from '@sentry/react';

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    console.warn('[MCC Driver] No VITE_SENTRY_DSN set — Sentry disabled.');
    return;
  }

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    beforeSend(event) {
      // Strip PII from breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => ({
          ...b,
          data: undefined,
        }));
      }
      return event;
    },
  });
}

export { Sentry };
