// ============================================================
// scripts/send-test-push.ts
// ============================================================
// Trigger a test native push to a specific driver/ride-along.
//
// Usage:
//   pnpm --filter @workspace/scripts run send-test-push -- \
//       --driver <driverId> [--message "Hello"] [--url "/home"]
//
//   pnpm --filter @workspace/scripts run send-test-push -- \
//       --ride-along <rideAlongDriverId>
//
// Manual delivery matrix to verify on a real device:
//   1. App in foreground          — banner via PushNotifications listener
//   2. App in background          — system banner + tap-to-open
//   3. App force-quit / killed    — system banner wakes the app
//
// Requires: API server running locally, and on the device side
// the build must be the Capacitor iOS build (APNs only works there,
// not in the browser preview).

import { argv, exit } from "node:process";

interface Args {
  audienceKind: "driver" | "ride_along_driver";
  audienceId: string;
  message?: string;
  url?: string;
  title?: string;
}

function parseArgs(): Args {
  const out: Partial<Args> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--driver" && next) {
      out.audienceKind = "driver";
      out.audienceId = next;
      i++;
    } else if (a === "--ride-along" && next) {
      out.audienceKind = "ride_along_driver";
      out.audienceId = next;
      i++;
    } else if (a === "--message" && next) {
      out.message = next;
      i++;
    } else if (a === "--url" && next) {
      out.url = next;
      i++;
    } else if (a === "--title" && next) {
      out.title = next;
      i++;
    }
  }
  if (!out.audienceId || !out.audienceKind) {
    console.error(
      "Usage: send-test-push --driver <id> | --ride-along <id> [--title T] [--message M] [--url /path]",
    );
    exit(2);
  }
  return out as Args;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const base = process.env["API_BASE_URL"] ?? "http://localhost:80";
  const url = `${base}/api/dev/push-test`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env["DISPATCH_API_KEY"];
  if (apiKey) headers["x-api-key"] = apiKey;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      audienceKind: args.audienceKind,
      audienceId: args.audienceId,
      title: args.title,
      message: args.message,
      url: args.url,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  console.log("HTTP", res.status, JSON.stringify(json, null, 2));
  if (!res.ok) exit(1);
}

void main().catch((err: unknown) => {
  console.error("send-test-push failed:", err);
  exit(1);
});
