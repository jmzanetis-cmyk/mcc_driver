# App Store Submission Runbook

End-to-end checklist for shipping the MCC Driver iOS build to TestFlight
and submitting to App Review. This document is the single source of
truth — every other file in `docs/app-store/` is referenced from here.

> **Where work happens:** All build, signing, and upload steps require
> a Mac with Xcode 16+. Replit can prepare the web bundle, the iOS
> shell, and the supporting backend state, but it cannot produce a
> signed `.ipa` or upload to App Store Connect.

---

## 0. Pre-flight checklist

- [ ] Apple Developer Program enrollment is **active** ($99/yr, paid).
- [ ] At least one team member has the **Admin** role in App Store
      Connect (required to create the app record + submit for review).
- [ ] Bundle id `com.mycarconcierge.driver` is registered in
      Certificates, IDs & Profiles → Identifiers → App IDs.
      - Push Notifications capability: **enabled**.
      - Associated Domains: not required for v1.
- [ ] A distribution certificate exists and is installed on the build
      Mac's keychain.
- [ ] An App Store provisioning profile for `com.mycarconcierge.driver`
      exists (Xcode can auto-manage this once the team is selected).
- [ ] An APNs auth key (`.p8`) has been generated and uploaded as
      `APNS_AUTH_KEY` (see `replit.md` → "Optional env: APNS_*").

---

## 1. Backend prep (Replit)

Run these in production-equivalent secrets. See `docs/deployment.md`
for the full secrets matrix.

- [ ] `pnpm --filter @workspace/db run push` against the production DB.
- [ ] Confirm `app_config` row exists with sane defaults — set
      `minSupportedVersion` **at or below** the build version you're
      about to ship so you don't kill your own release.
      (Admin UI: `/admin/app-config`.)
- [ ] One-time Supabase publication setup (production project):
      ```sql
      ALTER PUBLICATION supabase_realtime ADD TABLE driver_assignments;
      ALTER PUBLICATION supabase_realtime ADD TABLE rides;
      ```
- [ ] Smoke-test the production API:
      ```bash
      API_BASE=https://api.mycarconcierge.com/api \
        pnpm --filter @workspace/scripts run smoke-dispatch
      ```

---

## 2. Reviewer account (critical)

Apple's reviewers cannot receive real Supabase SMS OTPs on their
internal review devices. Use Supabase's first-class **Test Phone
Numbers** feature — this is App Store compliant (no production backdoor)
and the reviewer experience matches a real driver.

1. In the Supabase production project: **Authentication → Providers →
   Phone → Test OTP**. Add a row:
   - Phone: `+15555550199` (or any number you choose; must be a valid
     E.164 format Supabase will accept)
   - OTP: a fixed 6-digit code, e.g. `424242`
2. Seed the matching driver row + Supabase auth user via:
   ```bash
   REVIEWER_PHONE='+15555550199' \
     pnpm --filter @workspace/scripts run seed-reviewer-driver
   ```
   The script is idempotent — safe to re-run before every submission.
   It creates the Supabase auth user (if missing) and inserts/refreshes
   a fully-approved (`status='active'`, `background_check_passed=true`)
   driver row so the reviewer skips the application flow.
3. Record the exact phone + OTP in `docs/app-store/reviewer-notes.md`
   and paste that into App Store Connect → App Review Information →
   Sign-in Information.

---

## 3. Production build (Mac)

```bash
# 1. From the repo root on the Mac:
pnpm install

# 2. Build the web bundle for prod and sync into the iOS shell.
#    These envs are picked up by Vite at build time and baked into the
#    static bundle — there is no runtime config on iOS.
export VITE_API_BASE_URL='https://api.mycarconcierge.com'
export VITE_APP_ENV='production'
export VITE_SUPABASE_URL='https://<project>.supabase.co'
export VITE_SUPABASE_ANON_KEY='<anon key>'
export VITE_SENTRY_DSN='<driver DSN>'       # optional but recommended
export VITE_SENTRY_ENV='production'
pnpm --filter @workspace/driver run build:ios

# 3. Open Xcode
pnpm --filter @workspace/driver run ios:open
```

In Xcode:

- [ ] `App` target → General → bump **Version** and **Build** numbers.
      Version must match the `version` in
      `artifacts/driver/package.json` so the kill switch /
      forced-update comparison is consistent (see
      `replit.md` → "Remote kill switch & forced update").
- [ ] Signing & Capabilities:
  - Team: your Apple Developer team
  - Bundle id: `com.mycarconcierge.driver`
  - **Flip `App.entitlements` `aps-environment` from `development` →
    `production`** for the App Store / TestFlight build. (Revert for
    local debug builds.)
  - Push Notifications: ✓
  - Background Modes: Location updates ✓, Remote notifications ✓
- [ ] Product → Scheme → Edit Scheme → Run → Build Configuration =
      **Release**.
- [ ] Product → Archive. Wait for the Organizer to open.
- [ ] Distribute App → App Store Connect → Upload. Sign with the
      distribution cert, generate the symbols. Watch for export
      compliance prompts (see §4).

---

## 4. Export compliance

The app uses HTTPS only (no proprietary crypto). In `Info.plist` add:

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

This avoids the "Encryption" question on every TestFlight upload.

---

## 5. App Store Connect record

Most of this content already lives in `docs/app-store/`:

- **Name / Subtitle / Promotional text / Description / Keywords /
  Support URL / Marketing URL** → `listing-copy.md`.
- **Privacy Policy URL** → served publicly by the marketing artifact
  (`artifacts/marketing`) at `https://mycarconcierge.com/privacy`
  (and `/terms`, `/support`), rendered from `docs/app-store/*.md`.
  The in-app `/legal/{privacy,terms,support}` routes in the driver
  app remain as a fallback (hand-written React screens with
  equivalent content). App Store Connect's Privacy URL field accepts
  either.
- **App Privacy "nutrition label"** → `app-privacy.md` (paste answers
  one-by-one into the App Privacy section).
- **Age rating** answers → `listing-copy.md` § "Age rating".
- **App Review Information** → `reviewer-notes.md` (demo creds + how to
  drive the test flow).
- **EULA** → use Apple's default OR paste `terms-of-service.md` into
  the Custom EULA field.
- **Screenshots** → `screenshots/README.md` for required sizes. The
  upload **must** be done from a Mac simulator since App Store Connect
  validates exact pixel dimensions.

---

## 6. TestFlight (internal)

1. After the build finishes processing (~5–30 min), go to TestFlight →
   Internal Testing → add your team's testers.
2. Each tester installs TestFlight on their iPhone, accepts the
   invite, installs the build.
3. Run the **full driver lifecycle** at least once against production:
   - Sign in with the reviewer test phone + fixed OTP.
   - Land on Home (account is pre-approved by `seed-reviewer-driver`).
   - Toggle online → confirm location permission flow + green online
     pill.
   - From the admin panel (`/admin/drivers/:id`), dispatch a test ride
     to the reviewer driver.
   - Accept the modal → navigate stages: en route → arrived → in
     progress → complete.
   - Confirm earnings line appears on the Earnings tab.
4. File and fix blockers. Re-archive, re-upload. Repeat.

Edge cases to manually verify before submission:

- [ ] App resume after >15 min in background still receives the next
      dispatched ride (Realtime reconnect).
- [ ] Offline → reconnect surfaces the offline banner correctly.
- [ ] Forced-update screen renders if `minSupportedVersion` is bumped
      above the running build (admin panel → App Config). Reset the
      min version after testing.
- [ ] Outage banner renders + clears (admin panel → App Config).
- [ ] Delete Account flow completes end-to-end and the same phone can
      re-register after.

---

## 7. Submit for review

1. App Store Connect → your app → App Store tab → Prepare for
   Submission.
2. Pick the build from TestFlight.
3. Paste reviewer credentials into Sign-in Information (the phone
   number + the fixed OTP code you configured in §2).
4. Paste the review notes from `reviewer-notes.md` into Notes.
5. Confirm Export Compliance (§4) + Content Rights + Advertising
   Identifier answers.
6. Submit for Review.

Expected response time: 24–48 h. If rejected, address the feedback,
bump the build number, re-upload, re-submit. Most v1 rejections are:

- **Reviewer couldn't sign in** → re-check the Supabase Test Phone
  Number is still active and the seeded driver row still says
  `status='active'`. Re-run the seed script.
- **5.1.1(v) Account Deletion** → already implemented, see
  `replit.md` → "Account deletion".
- **2.5.1 Private API usage** → unlikely in a webview app.
- **4.0 Design / minimum functionality** → ensure the reviewer can
  actually receive a dispatched ride; that's why the reviewer notes
  include the "ask the dispatcher to send you a test ride" step.

---

## 8. Post-approval rollout

- [ ] Switch the release to **Manual** so it doesn't auto-release to
      the App Store the moment Apple approves.
- [ ] (Optional) Configure **Phased Release for Automatic Updates** —
      7-day ramp.
- [ ] Once live, set `latestVersion` in the admin App Config to the
      shipping version. Leave `minSupportedVersion` at the prior
      version for ~1 release cycle before bumping (so users have time
      to update before being force-locked).

---

## Rollback

If a release is bricked in the wild:

1. **Immediate**: Admin App Config → set `outageMessage` to a clear
   user-facing string. Users see a banner within ~60s.
2. **If unrecoverable client-side**: bump `minSupportedVersion` past
   the broken version to force everyone to update — but only AFTER you
   have a fixed build live in the App Store, otherwise you've just
   locked every driver out.
3. **API**: redeploy the previous git SHA via the deployment skill.
   Schema migrations should be backward-compatible by convention; if
   not, see `docs/deployment.md` § Rollback.
