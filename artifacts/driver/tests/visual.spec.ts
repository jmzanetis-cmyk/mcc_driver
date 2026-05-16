import { test, expect, type Page } from '@playwright/test';

/**
 * Visual-regression snapshots of the driver app's most-visible screens
 * in both light and dark theme. The `?theme=light|dark` deep-link
 * override (see ThemeToggle.tsx) lets us pin the theme without
 * clicking the toggle.
 *
 * Auth-gated screens (Home, Earnings, RideComplete) are NOT covered
 * here yet — they require a seeded Supabase session. See
 * `tests/README.md` for how to extend coverage once a test-mode
 * auth hook lands.
 */

type Theme = 'light' | 'dark';

// Paths are RELATIVE (no leading slash) so they resolve against
// `baseURL` (`http://localhost:80/driver/`) and stay inside the
// driver artifact. A leading `/` would escape the prefix and hit
// the marketing artifact at the project root.
const SCREENS: Array<{ name: string; path: string }> = [
  { name: 'signin', path: 'signin' },
  { name: 'apply', path: 'apply' },
  { name: 'pending', path: 'pending' },
  { name: 'privacy', path: 'legal/privacy' },
  { name: 'terms', path: 'legal/terms' },
  { name: 'support', path: 'legal/support' },
];

async function gotoStable(page: Page, path: string, theme: Theme): Promise<void> {
  const sep = path.includes('?') ? '&' : '?';
  await page.goto(`${path}${sep}theme=${theme}`, { waitUntil: 'networkidle' });
  // Belt-and-suspenders: explicitly set the data-theme attribute in case
  // the deep-link parser regresses. Keeps snapshots theme-stable.
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  // Wait for Playfair Display to load — otherwise the baseline can race
  // against the FOUT and produce flaky diffs.
  await page.evaluate(() => document.fonts.ready);
  // Hide the floating dev-banner pill ("DEVELOPMENT") so it doesn't bleed
  // into screenshots when running locally.
  await page.addStyleTag({
    content: `
      [data-replit-dev-banner], #replit-dev-banner { display: none !important; }
    `,
  });
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`driver app (${theme} theme)`, () => {
    for (const screen of SCREENS) {
      test(`${screen.name}`, async ({ page }) => {
        await gotoStable(page, screen.path, theme);
        await expect(page).toHaveScreenshot(`${screen.name}-${theme}.png`, {
          fullPage: true,
        });
      });
    }
  });
}
