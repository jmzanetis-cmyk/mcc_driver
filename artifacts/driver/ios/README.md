# MCC Driver — iOS Build

This is the Capacitor-wrapped iOS shell for the React + Vite driver app.
The web bundle is the source of truth: `pnpm --filter @workspace/driver run build:ios`
re-builds the bundle and copies it into `ios/App/App/public` via `cap sync`.

## What runs where

- The React app, Supabase JS, TanStack Query, Zustand, and every API hook
  load inside a `WKWebView` and behave the same as the web build.
- Native plugins (status bar, splash screen, keyboard, app lifecycle) are
  wired via Swift Package Manager — **no CocoaPods**.
- Push, geolocation, and other native features land in their own tasks.

## Prerequisites (Mac only)

- macOS with Xcode 16+ and Command Line Tools
- An Apple Developer account (for signing & TestFlight)
- Node 24 + pnpm (same as the rest of the monorepo)

## First-time setup on a Mac

```bash
# 1. From the repo root, install workspace deps
pnpm install

# 2. Build the web bundle + sync into the iOS app
pnpm --filter @workspace/driver run build:ios

# 3. Open the Xcode workspace
pnpm --filter @workspace/driver run ios:open
# (equivalent to: cd artifacts/driver/ios/App && open App.xcodeproj)
```

In Xcode:

1. Select the **App** target → **Signing & Capabilities**.
2. Set **Team** to your Apple Developer team and confirm the bundle id is
   `com.mycarconcierge.driver` (matches `capacitor.config.ts`).
3. Add the **Push Notifications** capability (the `App.entitlements` file
   already declares `aps-environment = development`).
4. Add the **Background Modes** capability and tick "Location updates" —
   needed by the geolocation task; harmless to leave on.
5. Pick a simulator (iPhone 15 Pro is a good default) and **Run**.

## Safe area, notch, keyboard

Audited during scaffolding — no additional iOS-specific CSS or screen
changes were required. The web app already uses
`env(safe-area-inset-*)` padding on `body` in
`artifacts/driver/src/theme/global.css`, so notch / home-indicator
spacing renders correctly inside the WKWebView. Keyboard behavior is
configured via the `Keyboard` plugin block in `capacitor.config.ts`
(`resize: "native"`, dark style), which avoids the white flash and
content overlap that the default iOS keyboard causes.

## Branded icon & splash

The committed `AppIcon.appiconset/AppIcon-512@2x.png` (1024×1024) and the
three `Splash.imageset/splash-2732x2732*.png` images are the My Car
Concierge brand logo on the dark brand background (`#0B1220`), generated
via ImageMagick from `artifacts/driver/public/mcc-driver-logo.png`.

Source assets for regeneration live at:

- `artifacts/driver/assets/icon-only.png` — 1254×1254 brand logo
- `artifacts/driver/assets/icon-foreground.png`
- `artifacts/driver/assets/splash.png`
- `artifacts/driver/assets/splash-dark.png`

If you want to regenerate the full iOS icon + splash set on a Mac (gives
better adaptive variants than the simple ImageMagick compose used here):

```bash
pnpm --filter @workspace/driver run ios:assets
pnpm --filter @workspace/driver run ios:sync
```

Note: `@capacitor/assets` depends on `sharp`, whose native binary does
not load on the Replit Linux container. Use the Mac for richer asset
regeneration; the committed images are sufficient for App Review.

## Day-to-day workflow

```bash
# 1. Pull latest, install
pnpm install

# 2. Re-build web bundle and copy into the iOS app
pnpm --filter @workspace/driver run build:ios

# 3. Re-run in Xcode (cmd+R)
```

For pure-web iteration, keep using the regular `pnpm --filter
@workspace/driver run dev` — Xcode is only needed when you touch native
config or want to test in a simulator / on device.

## Pointing the iOS build at staging vs prod

The Capacitor build is a static bundle, so the API URL is baked in at
`build:ios` time. Production deploys should run `build:ios` with the
production API base URL set as a Vite env (handled in the production
deployment task).

## Files of interest

- `artifacts/driver/capacitor.config.ts` — app id, name, webDir, plugin opts
- `ios/App/App/Info.plist` — bundle metadata and permission usage strings
- `ios/App/App/App.entitlements` — push notification entitlement
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/` — app icon set
- `ios/App/App/Assets.xcassets/Splash.imageset/` — splash images
- Capacitor 8 uses Swift Package Manager — there is **no** `Podfile` and
  no `App.xcworkspace`. Open `ios/App/App.xcodeproj` directly. Native
  plugin dependencies (`@capacitor/app`, `status-bar`, `splash-screen`,
  `keyboard`) are resolved via `ios/App/CapApp-SPM/Package.swift`,
  which `cap sync ios` rewrites automatically.

## Troubleshooting

- **White screen on launch** — the web bundle wasn't copied. Re-run
  `pnpm --filter @workspace/driver run build:ios` and rebuild in Xcode.
- **"No such module 'Capacitor'"** — Xcode hasn't resolved Swift Packages
  yet. File → Packages → Reset Package Caches, then build.
- **Signing errors** — the bundle id `com.mycarconcierge.driver` may
  already be claimed in your team. Change it in Xcode and mirror the
  change in `capacitor.config.ts`.
