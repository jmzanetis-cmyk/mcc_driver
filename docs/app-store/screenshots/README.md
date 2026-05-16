# App Store Screenshots

App Store Connect currently requires screenshots at:

- **6.7" iPhone display** — 1290 × 2796 px (iPhone 15 Pro Max, 14 Pro Max)
- **6.5" iPhone display** — 1284 × 2778 px or 1242 × 2688 px (iPhone 11 Pro Max)

Minimum 3 screenshots per size, up to 10 allowed.

## What's in this directory

Ten numbered captures of the public Driver App flows at the required
device sizes (5 flows × 2 sizes):

- `01-signin-67.jpg` / `01-signin-65.jpg` — Welcome / sign-in screen
- `02-privacy-67.jpg` / `02-privacy-65.jpg` — Privacy Policy screen
- `03-terms-67.jpg` / `03-terms-65.jpg` — Terms of Service screen
- `04-support-67.jpg` / `04-support-65.jpg` — Driver Support screen
- `05-apply-67.jpg` / `05-apply-65.jpg` — Driver Application (Step 1 of 3)

These meet the **minimum 3 per device size** requirement and can be
uploaded to App Store Connect as-is for first submission. They cover
the public-facing onboarding surface (sign-in + application) and the
legal screens App Review will inspect. Files are numbered in the
intended App Store Connect display order.

## Recommended additional captures (Mac + reviewer driver account required)

The remaining hero screenshots showcase the post-login product surface
and **cannot be captured from Replit** — the auth-gated routes all
redirect to `/signin` without a valid Supabase session, and the
Capacitor PushNotifications / native map UI only render inside the
iOS Simulator or a TestFlight device. They require:

- The native iOS Simulator (or a TestFlight device) running the
  Capacitor binary built from `pnpm --filter @workspace/driver run build:ios`
- The seeded App Review test driver signed in via the Supabase
  "Test OTP" phone number (see `replit.md` → "Reviewer demo account"
  and run `pnpm --filter @workspace/scripts run seed-reviewer-driver`)
- The driver row in the `active` state with at least one completed
  ride and a non-zero earnings balance for the Earnings screen

Capture these and drop them into this directory before the marketing
submission (drop existing `05-apply-*` to slot 09 if you'd rather lead
with the post-login flow):

- `06-home-67.jpg` / `06-home-65.jpg` — `/home` route, driver online
- `07-ride-request-67.jpg` / `07-ride-request-65.jpg` — `/home` with
  ride-request modal open
- `08-navigate-67.jpg` / `08-navigate-65.jpg` — `/ride/:id/navigate`
  mid-ride
- `09-earnings-67.jpg` / `09-earnings-65.jpg` — `/earnings` with weekly
  chart and Instant Pay
- `10-settings-67.jpg` / `10-settings-65.jpg` — `/settings` Account &
  Legal cards

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

The eight `.jpg` files were produced in two steps:

1. Captured against the Replit dev preview at iPhone-15-Pro-Max
   (430 × 932 logical) and iPhone-11-Pro-Max (414 × 896 logical)
   viewport sizes — the React layout that ships in the Capacitor
   binary is the same React bundle and theme, so the composition
   matches what App Review will see in TestFlight.
2. Upscaled to the exact App Store Connect pixel dimensions with
   ImageMagick so the files pass the upload size check:

   ```sh
   cd docs/app-store/screenshots
   for f in *-67.jpg; do magick "$f" -resize 1290x2796\! -quality 92 "$f.tmp" && mv "$f.tmp" "$f"; done
   for f in *-65.jpg; do magick "$f" -resize 1284x2778\! -quality 92 "$f.tmp" && mv "$f.tmp" "$f"; done
   identify *.jpg   # sanity check: every file should be 1290x2796 or 1284x2778
   ```

Native simulator captures from a Mac (procedure below) are preferred
for the marketing submission because they are crisp at native pixel
density rather than bilinearly upscaled — re-run that procedure for
the final marketing build and overwrite these files. The current
files are valid for the initial App Store Connect upload (they pass
the dimension check) but should be replaced before the public
listing goes live.

## Pre-upload dimension check

Before uploading, confirm every file is at the required pixel size:

```sh
cd docs/app-store/screenshots
for f in *-67.jpg; do identify -format "%w %h %f\n" "$f" | awk '$1!=1290 || $2!=2796 {print "BAD: "$0; exit 1}'; done
for f in *-65.jpg; do identify -format "%w %h %f\n" "$f" | awk '$1!=1284 || $2!=2778 {print "BAD: "$0; exit 1}'; done
```
