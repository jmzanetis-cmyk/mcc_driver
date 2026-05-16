import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { sentryVitePlugin } from "@sentry/vite-plugin";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// Derive a deterministic release tag (pkgVersion+gitSha) so Sentry events
// can be grouped per build. Env override wins; otherwise we compute from
// package.json + short git SHA. Falls back gracefully if git is unavailable.
function resolveRelease(): string {
  if (process.env.VITE_SENTRY_RELEASE) return process.env.VITE_SENTRY_RELEASE;
  const pkg = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8"),
  ) as { version?: string; name?: string };
  let sha = "nogit";
  try {
    sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim() || "nogit";
  } catch {
    /* no git in sandbox — keep "nogit" */
  }
  return `${pkg.name ?? "driver"}@${pkg.version ?? "0.0.0"}+${sha}`;
}

const release = resolveRelease();
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;

export default defineConfig({
  base: basePath,
  define: {
    __SENTRY_RELEASE__: JSON.stringify(release),
    // Expose VITE_API_BASE_URL + VITE_APP_ENV through import.meta.env so
    // `services/api/baseUrl.ts` can pick the right API origin per build
    // (web preview vs native iOS prod/staging). Both are deliberately
    // left undefined in dev so the app falls back to relative `/api/*`.
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    // Sentry source-map upload. No-ops cleanly when SENTRY_AUTH_TOKEN /
    // SENTRY_ORG / SENTRY_PROJECT are not configured (dev default), but
    // still injects the matching release id into the bundle so future
    // uploads (e.g. from a Mac iOS build) can attach.
    sentryVitePlugin({
      org: sentryOrg,
      project: sentryProject,
      authToken: sentryAuthToken,
      release: { name: release, inject: true },
      sourcemaps: { assets: "./dist/public/**" },
      disable: !sentryAuthToken || !sentryOrg || !sentryProject,
      telemetry: false,
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
