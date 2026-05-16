import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Sentry from "@sentry/node";

const DSN = process.env["SENTRY_DSN"];
const ENV =
  process.env["SENTRY_ENV"] ??
  process.env["NODE_ENV"] ??
  "development";

function resolveRelease(): string | undefined {
  if (process.env["SENTRY_RELEASE"]) return process.env["SENTRY_RELEASE"];
  try {
    // Walk up from this file to find the api-server package.json. We accept
    // either source layout (src/lib) or bundled dist layout.
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      resolve(here, "../../package.json"),
      resolve(here, "../package.json"),
    ];
    let pkg: { name?: string; version?: string } | null = null;
    for (const candidate of candidates) {
      try {
        pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.version) break;
      } catch {
        /* try next */
      }
    }
    if (!pkg?.version) return undefined;
    let sha = "nogit";
    try {
      sha =
        execSync("git rev-parse --short HEAD", {
          stdio: ["ignore", "pipe", "ignore"],
        })
          .toString()
          .trim() || "nogit";
    } catch {
      /* git not available — keep nogit */
    }
    return `${pkg.name ?? "api-server"}@${pkg.version}+${sha}`;
  } catch {
    return undefined;
  }
}

const RELEASE = resolveRelease();

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

/**
 * Attach the authenticated identity (Supabase user id and/or driver id) to
 * the current request's isolation scope so any error captured later in the
 * request lifecycle is grouped against the correct user. id-only — no PII.
 */
export function setSentryRequestIdentity(
  ids: { userId?: string; driverId?: string },
): void {
  if (!initialized) return;
  const scope = Sentry.getIsolationScope();
  if (ids.userId) scope.setUser({ id: ids.userId });
  if (ids.driverId) scope.setTag("driver_id", ids.driverId);
}

export { Sentry };
