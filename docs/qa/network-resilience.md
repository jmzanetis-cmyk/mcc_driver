# Network Resilience — Airplane Mode QA Checklist

Manual QA pass for Task #80. Run on a real device (iOS Capacitor build
preferred; web preview acceptable for non-native paths). Toggle airplane
mode at the timestamps noted below.

## Setup

- Driver signed in, status = `active`, profile loaded.
- API server reachable from device.
- One dispatchable scenario seeded (`pnpm --filter @workspace/scripts run smoke-dispatch` is fine).
- Device on Wi-Fi with a known-good signal; airplane mode toggle ready.

## Global indicators

| # | Step | Expected |
|---|------|----------|
| G1 | App online, idle on Home | No red banner. |
| G2 | Toggle airplane mode ON | Red **"You're offline"** banner appears at the top within ~2 s. |
| G3 | Toggle airplane mode OFF | Banner flips to green **"Back online"** for ~2.5 s, then disappears. TanStack Query refetches in flight (network tab shows requests). |
| G4 | Background tab → offline → foreground | Banner reflects current status on return. |

## Sign-in (`/signin`)

| # | Step | Expected |
|---|------|----------|
| S1 | Offline, enter phone, **Send Code** | Inline error **"You're offline — connect to send a verification code."** No network request fired. OfflineNotice visible above form. |
| S2 | Online, send code; go offline; enter code; **Verify** | Inline error **"You're offline — connect to verify the code."** |
| S3 | Restore network, **Verify** | Code verifies normally. |

## Driver application (`/apply`)

| # | Step | Expected |
|---|------|----------|
| A1 | Fill steps 1–3 online, draft auto-saved | Continue button enabled per step. |
| A2 | Offline on final step, **Submit Application** | Inline error **"You're offline — connect to submit your application. Your progress is saved."** Draft remains in localStorage. |
| A3 | Restore network, **Submit Application** | Submission succeeds, navigates to `/pending`. |

## Ride-along application (`/ride-along-apply`)

| # | Step | Expected |
|---|------|----------|
| R1 | Offline on final step, **Submit** | Inline error message; no POST fired. |
| R2 | Restore network, **Submit** | Submission succeeds. |

## Home dashboard (`/home`)

| # | Step | Expected |
|---|------|----------|
| H1 | Land on Home offline | Today / Week earnings show cached values (or zeros on first launch). If Supabase fetch fails, **"Couldn't refresh today's earnings"** card with **Retry**. |
| H2 | Online, tap **Retry** | Card disappears, spinner briefly visible, fresh values render. |
| H3 | Online, toggle **Go Online** | Toggle works. Offline → toggle disabled / no state change (driverStatus mutation fails fast with toast). |

## Incoming ride offer (`/home` modal)

| # | Step | Expected |
|---|------|----------|
| O1 | Dispatch an offer while driver is online; go offline before accepting; tap **Accept Ride** | Inline error **"You're offline. Reconnect and try again before the timer expires."** OfflineNotice visible above buttons. Timer keeps counting. |
| O2 | Reconnect within deadline, **Accept Ride** | Accept POST fires, navigates to `/ride/:id/navigate`. |
| O3 | Stay offline through deadline | Countdown expires, modal dismisses, server cascades. |

## Ride-along dashboard (`/ride-along`)

| # | Step | Expected |
|---|------|----------|
| D1 | Offline, tap **Accept** on a broadcast | Inline error **"You're offline — connect to accept matches."** No POST fired. |
| D2 | Offline, tap **Decline** | Inline error **"You're offline — connect to decline matches."** |

## Set up payouts (`/settings/payments`)

| # | Step | Expected |
|---|------|----------|
| P1 | Offline, **Start onboarding** | Error state with **"You're offline — connect to set up your payment account."** |
| P2 | Offline, **Continue setup** | Error state with **"You're offline — connect to continue setup."** |
| P3 | Restore network, **Continue setup** | Stripe link opens. |

## Instant Pay (`/instant-pay`)

| # | Step | Expected |
|---|------|----------|
| I1 | Offline, tap **Instant Pay** | OfflineNotice visible; cash-out short-circuited, no POST. Global banner shown. |
| I2 | Online, **Instant Pay** | Confirmation modal → cash-out succeeds. |

## Active ride — graceful degradation

Run a full ride end-to-end with airplane mode toggled at each stage.

| # | Step | Expected |
|---|------|----------|
| L1 | Accepted, en route, online | Location broadcasts every 8 s (server log shows `driver_location_updated`). |
| L2 | Mid-trip, airplane mode ON | Geolocation watch keeps recording locally; broadcast interval **skips POST** (server stops receiving). Red offline banner visible. No crashes, no UI lock-up. Stage buttons (Arrived, In Progress, Complete) show error banner if tapped offline (mutation fails fast). |
| L3 | Airplane mode OFF | NetworkResyncBridge fires: queries invalidate, `supabase.realtime.connect()` called. Next 8 s tick POSTs the latest fix. Realtime subscription resumes. |
| L4 | While offline, dispatcher cancels ride in admin | After reconnect, `rides` UPDATE arrives within ~10 s; `ActiveRideWatcher` fires the cancellation modal and navigates Home. |

## Supabase realtime reconnect

| # | Step | Expected |
|---|------|----------|
| RT1 | Subscribed to ride offers; offline 60 s; reconnect | Within ~10 s of reconnect, a fresh dispatch is received (no app restart needed). NetworkResyncBridge log: `realtime.connect()` called. |
| RT2 | Subscribed to cancellation; offline; cancellation issued; reconnect | Cancellation modal shows on reconnect. |

## Form submit fail-fast (general)

| # | Step | Expected |
|---|------|----------|
| F1 | Any mutation tapped while offline | Fails immediately with inline error. **Never** spins indefinitely. |
| F2 | Mutation tapped while transitioning (online → offline mid-flight) | Fetch rejects, error surfaces inline. Retry available. |

## Sign-off

- [ ] All rows above pass.
- [ ] No console errors specific to network state changes.
- [ ] Sentry receives no new error groups from network drops (graceful degradation only).
- [ ] Driver app remains responsive throughout (no frozen spinners, no stuck modals).

Tested by: ______ Date: ______ Build: ______
