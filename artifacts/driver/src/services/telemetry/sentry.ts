import * as SentryCapacitor from '@sentry/capacitor';
import * as SentryReact from '@sentry/react';

export interface Breadcrumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
  level?: string;
}

declare const __SENTRY_RELEASE__: string | undefined;

const DSN = import.meta.env['VITE_SENTRY_DSN'] as string | undefined;
// Prefer the build-time-injected release (pkgVersion+gitSha from vite.config),
// fall back to explicit env override, then undefined.
const RELEASE =
  (typeof __SENTRY_RELEASE__ !== 'undefined' ? __SENTRY_RELEASE__ : undefined) ??
  (import.meta.env['VITE_SENTRY_RELEASE'] as string | undefined);
const ENV =
  (import.meta.env['VITE_SENTRY_ENV'] as string | undefined) ??
  (import.meta.env.DEV ? 'development' : 'production');

let enabled = false;

const PII_KEYS = new Set([
  'phone',
  'phone_number',
  'phoneNumber',
  'email',
  'name',
  'first_name',
  'firstName',
  'last_name',
  'lastName',
  'full_name',
  'fullName',
  'authorization',
  'Authorization',
  'access_token',
  'refresh_token',
  'password',
]);

function scrubPii<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => scrubPii(v, depth + 1)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEYS.has(k) ? '[scrubbed]' : scrubPii(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

export function initSentry(): void {
  if (!DSN) {
    if (import.meta.env.DEV) console.log('[sentry] no DSN configured, skipping init');
    return;
  }
  SentryCapacitor.init(
    {
      dsn: DSN,
      environment: ENV,
      release: RELEASE,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend(event) {
        if (event.request?.headers) {
          event.request.headers = scrubPii(event.request.headers);
        }
        if (event.request?.data) {
          event.request.data = scrubPii(event.request.data);
        }
        if (event.user) {
          event.user = { id: event.user.id } as typeof event.user;
        }
        if (event.extra) event.extra = scrubPii(event.extra);
        if (event.contexts) event.contexts = scrubPii(event.contexts);
        return event;
      },
      beforeBreadcrumb(crumb) {
        if (crumb.data) crumb.data = scrubPii(crumb.data);
        return crumb;
      },
    },
    SentryReact.init,
  );
  enabled = true;
}

export function setSentryUser(driverId: string | null): void {
  if (!enabled) return;
  if (driverId) SentryCapacitor.setUser({ id: driverId });
  else SentryCapacitor.setUser(null);
}

export function captureException(err: unknown): void {
  if (!enabled) return;
  SentryCapacitor.captureException(err);
}

export function captureMessage(msg: string, context?: Record<string, unknown>): void {
  if (!enabled) return;
  SentryCapacitor.captureMessage(msg, { extra: scrubPii(context ?? {}) });
}

export function addBreadcrumb(breadcrumb: Breadcrumb): void {
  if (!enabled) return;
  SentryCapacitor.addBreadcrumb({
    category: breadcrumb.category,
    message: breadcrumb.message,
    data: breadcrumb.data ? scrubPii(breadcrumb.data) : undefined,
    level: breadcrumb.level as SentryCapacitor.SeverityLevel | undefined,
  });
}

export const Sentry = { captureException, captureMessage, addBreadcrumb, setUser: setSentryUser };
