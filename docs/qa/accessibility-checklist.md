# Driver App — Accessibility QA Checklist

Manual checklist run before every TestFlight build. Targets:
WCAG 2.1 AA, Apple HIG (touch targets ≥ 44pt, Dynamic Type),
and the App Store Guideline 1.5 accessibility requirement.

Out of scope: RTL, Voice Control, WCAG AAA.

## Setup (iPhone, iOS Simulator or device)

1. Install the staging build (`VITE_APP_ENV=staging`).
2. Settings → Accessibility → **VoiceOver = On** (triple-click side
   button to toggle quickly).
3. Settings → Accessibility → Display & Text Size → **Larger Text**
   → drag the slider to the last *non-accessibility* notch
   (the standard XXL setting — not the red "Larger Accessibility
   Sizes" range).
4. Settings → Accessibility → Display & Text Size → **Bold Text = On**.
5. Settings → Accessibility → Motion → **Reduce Motion = On** for
   one pass, then off for the next.

## VoiceOver — every actionable element has an accessible name

Swipe right through each screen with VoiceOver on. **Every** focusable
element should announce something other than "button", "image", or
"edit text". Spot-check:

- [ ] **Sign In** — Phone field is announced as "Phone Number, required,
      edit text". Validation error is announced when it appears.
- [ ] **Sign In → Code step** — Verification Code field reads correctly;
      "Use a different number" button reads its label.
- [ ] **Home header** — Theme toggle reads "Switch to light/dark mode".
      Avatar reads **"Open settings for <name>"** (not "<initials>, button").
- [ ] **Home — OnlineToggle** — reads "Go online — start accepting
      rides, switch, off" → after tap → "Go offline — stop accepting
      rides, switch, on".
- [ ] **Home — quick action cards** (Earnings, Scheduled, Settings,
      AI Support, Ride-Along) — each reads a meaningful label.
- [ ] **PageHeader back button** — reads "Go back, button" on every
      sub-screen.
- [ ] **InstantPay** — "×" dismiss button reads "Dismiss payout
      result, button".
- [ ] **Settings → Delete Account** — confirmation buttons read
      their full label.

## RideRequestModal — the critical path

This is the highest-stakes screen — a driver must be able to accept
or decline a ride without sight.

- [ ] When the modal slides up, focus moves into it and VoiceOver
      announces the ride title (scenario label) first.
- [ ] The countdown timer is announced **politely** every 5 seconds
      (and every second under 10s remaining). Announcements do not
      interrupt other speech.
- [ ] Swiping right reaches the **Accept Ride** and **Decline**
      buttons within a handful of swipes — they are not buried at
      the bottom after every card.
- [ ] Both Accept and Decline announce their full label and hit
      target measures ≥ 44 × 44 pt (visual check — buttons span
      the modal width with `size="lg"`).
- [ ] After tapping Accept, "Accept Ride" announces as busy
      (`aria-busy`) until navigation completes.
- [ ] With **Reduce Motion** on, the modal appears without the
      slide-up animation.

## Dynamic Type — largest non-accessibility size

Re-walk the app with the OS at the largest standard (non-AX) text
size. Layouts should reflow, not clip.

- [ ] Sign In screen — phone field, button, legal links all visible
      and tappable; no horizontal scroll.
- [ ] Home — stat cards stack or wrap; "Welcome back, <name>" does
      not truncate awkwardly; OnlineToggle text fits.
- [ ] RideRequestModal — title, estimated earnings, and Accept /
      Decline buttons remain visible within `85vh` max height
      (modal scrolls internally — confirm scrolling works).
- [ ] Navigate screen — pickup/dropoff InfoRows wrap their text;
      "Mark Arrived / Start Ride / Complete" buttons stay full-width.
- [ ] Earnings & Settings — list rows do not clip values.

## Color contrast — WCAG AA

Use Xcode's Accessibility Inspector → **Audit** on each screen,
or spot-check with a contrast tool. Targets: 4.5:1 for normal text,
3:1 for large text (≥ 18.66 px bold or ≥ 24 px regular) and UI
component boundaries.

- [ ] `--text-muted` against `--bg-card` and `--bg-deep` in both
      themes (currently #9ca3af / #5c5c7a — should pass).
- [ ] White text on `--accent-gold` button (dark mode brand CTA).
- [ ] Red error text on red-tinted error banner (RideRequestModal
      `acceptError`, InstantPay payout-failed card).
- [ ] Status text on `--success-bg` and `--error-bg`.
- [ ] Light-theme audit run separately — light mode uses deeper
      navy / brand colors for higher contrast.

## Touch targets — primary actions ≥ 44 pt

Visually measure (or trust the components — they now declare
`minHeight: 44`):

- [ ] Sign In: Send Code / Verify buttons (`size="lg"`).
- [ ] RideRequestModal: Accept Ride / Decline (`size="lg"`).
- [ ] Navigate: Mark Arrived / Start Ride / Complete Ride.
- [ ] Home: OnlineToggle (48 pt).
- [ ] PageHeader back arrow (44 × 44 with icon centered).
- [ ] InstantPay × close (44 × 44).
- [ ] Home avatar → settings (44 × 44).

## Forms — labels and announced errors

- [ ] Every `<input>` has a programmatic label (tap the label
      text — focus jumps to the field).
- [ ] Submitting an invalid form announces the error via
      VoiceOver immediately (`role="alert"` on Input error text).
- [ ] Required fields announce "required" (sr-only "(required)"
      span on the label).

## Smoke pass — what to do if any check fails

1. File a follow-up under the original accessibility task.
2. Reference the offending screen + element name from this list
   so the next pass can verify the fix in isolation.
3. Block App Store submission on any failure in the
   **RideRequestModal**, **Sign In**, or **touch target** sections —
   the other sections are nice-to-haves for v1 but should be
   resolved before v1.1.
