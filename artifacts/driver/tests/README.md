# Driver app visual-regression tests

Playwright snapshot suite that guards the driver app's editorial
look-and-feel against accidental drift. Catches token changes,
font swaps, broken `data-theme` flipping, and layout regressions
in PRs.

## What's covered

Six unauthenticated screens in both light and dark theme:

- Sign In (`/signin`)
- Application (`/apply`, step 1)
- Pending (`/pending`)
- Privacy Policy (`/legal/privacy`)
- Terms of Service (`/legal/terms`)
- Support (`/legal/support`)

The deep-link `?theme=light|dark` (handled by `ThemeToggle.tsx`)
pins the theme without UI interaction, so baselines stay stable.

## Running

The `artifacts/driver: web` workflow must be running first (the
suite hits the same `localhost:80/driver/*` paths the preview
pane uses). Then from repo root:

```bash
# Run the suite (compares to existing baselines)
pnpm --filter @workspace/driver run test:visual

# Refresh baselines after an intentional visual change
pnpm --filter @workspace/driver run test:visual:update

# Open the HTML diff report after a failure
pnpm --filter @workspace/driver exec playwright show-report
```

Baselines live next to the spec under
`tests/__screenshots__/visual.spec.ts/` and are committed so
PRs surface drift as a visible diff.

## What's NOT covered yet

The authenticated screens (Home, Earnings, Navigate, RideComplete,
Settings) require a seeded Supabase session and a `drivers` row,
which the driver app intentionally does not bypass — there is no
dev-only auth backdoor (would be grounds for App Store rejection;
see `replit.md` § "Reviewer demo account").

To extend coverage, a future change would need to either:

1. Introduce a `VITE_E2E_AUTH_BYPASS` build flag that's stripped
   from production bundles and stubs `AuthProvider` with a fixture
   driver, or
2. Use the `seed-reviewer-driver` script + Supabase test-OTP feature
   to log in programmatically from Playwright.

Both are sized as their own task — file a follow-up before doing
either.

## Notes on flakiness

- `gotoStable()` waits for `document.fonts.ready` so Playfair
  Display is fully loaded before the snapshot — critical, since
  the FOUT replaces serif with a fallback metric and busts every
  baseline.
- `animations: 'disabled'` and `caret: 'hide'` are set globally
  in `playwright.config.ts` to suppress the theme-transition
  fade and input-cursor blink.
- The dev banner pill is hidden via `addStyleTag` so its
  conditional rendering can't bust baselines.
- `maxDiffPixelRatio: 0.02` gives a 2 % per-pixel tolerance for
  cross-machine font anti-aliasing jitter. Bump it down if drift
  starts slipping through.
