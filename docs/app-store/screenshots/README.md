# App Store Screenshots

App Store Connect currently requires screenshots at:

- **6.7" iPhone display** — 1290 × 2796 px (iPhone 15 Pro Max, 14 Pro Max)
- **6.5" iPhone display** — 1284 × 2778 px or 1242 × 2688 px (iPhone 11 Pro Max)

The 6.7" set is the primary required set. The 6.5" set can be
auto-derived from the 6.7" assets in App Store Connect, but providing
native captures looks sharper.

## Required shots (minimum 3, recommend 5 per size)

1. **Welcome / Sign In** — `/signin` route. Captures the brand-forward
   black hero and gold accent.
2. **Online Dashboard** — `/home` route with the driver online, ready to
   receive a ride.
3. **Incoming Ride Request** — `/home` with a mock ride request modal
   open, showing fare, pickup, drop-off, and accept/decline.
4. **Navigate** — `/ride/:id/navigate` mid-ride, stage = `en_route`,
   showing the pickup card.
5. **Earnings** — `/earnings` route showing the weekly chart and Instant
   Pay button.

## How to capture (Mac required)

Real captures must run against the iOS Simulator on a Mac because the
Driver App is shipped as a Capacitor binary and several screens depend
on native APIs (location, push). On Replit we can only capture the
web preview as a stand-in.

```
# On a Mac with Xcode installed
pnpm --filter @workspace/driver run build:ios
pnpm --filter @workspace/driver run ios:open
# In Xcode: select iPhone 15 Pro Max simulator → Run
# Use Device > Screenshot (⌘S) on each screen above
# Save the .png files into this directory as:
#   01-signin-67.png
#   02-home-67.png
#   03-ride-request-67.png
#   04-navigate-67.png
#   05-earnings-67.png
# Repeat with iPhone 11 Pro Max for the 6.5" set.
```

## Web preview reference captures (this repo)

For listing-prep review, web previews of the unauthenticated screens
captured against the Replit dev preview at iPhone-15-Pro-Max viewport
(390 × 844 logical, 1290 × 2796 device pixels) are saved alongside
this README. These are **reference only** — App Store Connect uploads
must be the native iOS captures from the simulator.
