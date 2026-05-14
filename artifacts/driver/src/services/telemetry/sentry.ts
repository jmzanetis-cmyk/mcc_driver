export interface Breadcrumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
  level?: string;
}

export function initSentry(): void {}
export function captureException(_err: unknown): void {}
export function captureMessage(_msg: string, _context?: Record<string, unknown>): void {}
export function addBreadcrumb(_breadcrumb: Breadcrumb): void {}

export const Sentry = { captureException, captureMessage, addBreadcrumb };
