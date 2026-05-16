# App Store Screenshots

App Store Connect currently requires screenshots at:

- **6.7" iPhone display** — 1290 × 2796 px (iPhone 15 Pro Max, 14 Pro Max)
- **6.5" iPhone display** — 1284 × 2778 px or 1242 × 2688 px (iPhone 11 Pro Max)

Minimum 3 screenshots per size, up to 10 allowed.

## What's in this directory

Eight numbered captures of the public Driver App flows at the required
device sizes (4 flows × 2 sizes):

- `01-signin-67.jpg` / `01-signin-65.jpg` — Welcome / sign-in screen
- `02-privacy-67.jpg` / `02-privacy-65.jpg` — Privacy Policy screen
- `03-terms-67.jpg` / `03-terms-65.jpg` — Terms of Service screen
- `04-support-67.jpg` / `04-support-65.jpg` — Driver Support screen

These meet the **minimum 3 per device size** requirement and can be
uploaded to App Store Connect as-is for first submission. They cover
the public-facing onboarding surface and the legal screens App Review
will inspect.

## Recommended additional captures (require Mac + test driver account)

The remaining hero screenshots showcase the post-login product surface
and can only be captured from a Mac because they require:

- The native iOS Simulator (or a TestFlight device) running the
  Capacitor binary
- An authenticated test driver in the `active` state with at least one
  completed ride and a non-zero earnings balance

Capture these and drop them into this directory before the marketing
submission:

- `05-home-67.jpg` / `05-home-65.jpg` — `/home` route, driver online
- `06-ride-request-67.jpg` / `06-ride-request-65.jpg` — `/home` with
  ride-request modal open
- `07-navigate-67.jpg` / `07-navigate-65.jpg` — `/ride/:id/navigate`
  mid-ride
- `08-earnings-67.jpg` / `08-earnings-65.jpg` — `/earnings` with weekly
  chart and Instant Pay

## How to capture (Mac required for the additional shots)

```sh
# On a Mac with Xcode installed
pnpm --filter @workspace/driver run build:ios
pnpm --filter @workspace/driver run ios:open
# In Xcode: select iPhone 15 Pro Max simulator → Run
# Sign in with the App Review test driver
# Use Device > Screenshot (⌘S) on each screen
# Repeat with iPhone 11 Pro Max for the 6.5" set
```

## How the in-repo captures were produced

The eight `.jpg` files in this directory were captured against the
Replit dev preview at the listed iPhone-15-Pro-Max (430 × 932 logical)
and iPhone-11-Pro-Max (414 × 896 logical) viewport sizes. Because the
public flows render identically on web and on the Capacitor binary
(same React bundle, same theme), they are submission-quality for the
sign-in and legal surfaces.
