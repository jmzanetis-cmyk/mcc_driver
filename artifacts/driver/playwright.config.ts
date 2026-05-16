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
    baseURL: process.env.DRIVER_TEST_BASE_URL ?? 'http://localhost:80/driver',
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
