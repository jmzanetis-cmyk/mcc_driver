import * as Sentry from "@sentry/node";

const DSN = process.env["SENTRY_DSN"];
const ENV =
  process.env["SENTRY_ENV"] ??
  process.env["NODE_ENV"] ??
  "development";
const RELEASE = process.env["SENTRY_RELEASE"];

const PII_KEYS = new Set<string>([
  "phone",
  "phone_number",
  "phoneNumber",
  "email",
  "name",
  "first_name",
  "firstName",
  "last_name",
  "lastName",
  "full_name",
  "fullName",
  "authorization",
  "Authorization",
  "cookie",
  "Cookie",
  "access_token",
  "refresh_token",
  "password",
]);

function scrub<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => scrub(v, depth + 1)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = PII_KEYS.has(k) ? "[scrubbed]" : scrub(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  if (!DSN) {
    // No DSN configured — SDK no-ops cleanly in dev.
    return;
  }
  Sentry.init({
    dsn: DSN,
    environment: ENV,
    release: RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request?.headers) {
        event.request.headers = scrub(event.request.headers);
      }
      if (event.request?.data) {
        event.request.data = scrub(event.request.data);
      }
      if (event.request?.cookies) {
        event.request.cookies = scrub(event.request.cookies);
      }
      if (event.user) {
        event.user = { id: event.user.id };
      }
      if (event.extra) event.extra = scrub(event.extra);
      if (event.contexts) event.contexts = scrub(event.contexts);
      return event;
    },
    beforeBreadcrumb(crumb) {
      if (crumb.data) crumb.data = scrub(crumb.data);
      return crumb;
    },
  });
  initialized = true;
}

export function isSentryEnabled(): boolean {
  return initialized;
}

export { Sentry };
