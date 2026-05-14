import { Sentry } from './sentry';

export const logger = {
  info(event: string, payload?: unknown): void {
    if (import.meta.env.DEV) console.log(`[INFO] ${event}`, payload ?? '');
    Sentry.addBreadcrumb({ category: 'info', message: event, data: payload as Record<string, unknown>, level: 'info' });
  },

  warn(event: string, payload?: unknown): void {
    console.warn(`[WARN] ${event}`, payload ?? '');
    Sentry.addBreadcrumb({ category: 'warning', message: event, data: payload as Record<string, unknown>, level: 'warning' });
  },

  error(event: string, payload?: unknown): void {
    console.error(`[ERROR] ${event}`, payload ?? '');
    if (payload instanceof Error) {
      Sentry.captureException(payload);
    } else {
      Sentry.captureMessage(event, { extra: { payload } });
    }
  },
};
