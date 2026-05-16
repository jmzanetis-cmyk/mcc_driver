import { defineConfig, devices } from '@playwright/test';

/**
 * Visual-regression snapshot suite for the driver app.
 *
 * Runs against the locally proxied dev server at `http://localhost:80/driver/`
 * (the same path the user sees in the preview pane). The `artifacts/driver: web`
 * workflow must be running.
 *
 * To update baselines after an intentional visual change:
 *   pnpm --filter @workspace/driver run test:visual:update
 *
 * Snapshots live next to the spec file under `tests/__screenshots__/`.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    // Trailing slash is significant: paths in specs are written as
    // `signin`, `legal/privacy`, etc. (relative). An absolute path like
    // `/signin` would resolve to `http://localhost:80/signin`, escaping
    // the `/driver` prefix and landing on the marketing artifact's
    // 404 — which is how the first baselines were silently generated
    // against the wrong page.
    baseURL: process.env.DRIVER_TEST_BASE_URL ?? 'http://localhost:80/driver/',
    trace: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: {
      // Small per-pixel tolerance for font-rendering jitter between machines.
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
});
