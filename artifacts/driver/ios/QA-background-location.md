# Background Location — Device QA Checklist

Run on a real iPhone after `pnpm --filter @workspace/driver run build:ios` and signing in Xcode. Replit's container cannot simulate iOS background behaviour, so this manual pass is required before any release that touches the location pipeline.

## Setup

- [ ] Driver account is `status = active` and approved
- [ ] iPhone has cellular or Wi-Fi
- [ ] Connected to Xcode console (optional but useful for log capture)
- [ ] In Postgres: note current values of `drivers.current_lat`, `current_lng`, `location_updated_at` for the test driver

## Permission prompts

- [ ] First go-online: iOS "Allow While Using App" prompt appears after the in-app rationale dialog
- [ ] Granting "While Using" flips the driver online and the OnlineToggle shows green
- [ ] Denying surfaces the in-app "Location permission denied" message and keeps the driver offline
- [ ] On accepting a ride, the in-app "Allow background location" rationale appears once
- [ ] Tapping Continue triggers the iOS "Change to Always Allow?" system dialog
- [ ] Choosing "Change to Always Allow" returns the driver to the Navigate screen with no errors

## Foreground tracking — idle (online, no ride)

- [ ] Postgres `current_lat/current_lng` updates roughly every 30 s
- [ ] `location_updated_at` advances on each write
- [ ] No iOS blue background-location indicator shown (driver is in foreground)

## Foreground tracking — active ride

- [ ] After accept, cadence increases to every ~12 s
- [ ] Coordinates track the device's actual movement
- [ ] Server returns 200 (and occasional 202 throttled, expected at <8 s)

## Background / locked-screen tracking (the headline test)

- [ ] Accept a ride and start moving
- [ ] Lock the phone screen
- [ ] Walk or drive for **at least 10 minutes**
- [ ] Throughout: iOS shows the blue "App is using your location" bar/pill
- [ ] Postgres `current_lat/current_lng` and `location_updated_at` continue advancing the entire time
- [ ] No watchdog termination — Xcode console shows continuous geolocation callbacks

## Going offline

- [ ] Toggle offline from Home
- [ ] iOS blue location indicator disappears within ~30 s
- [ ] Postgres `location_updated_at` stops advancing
- [ ] Server logs show no further `/api/drivers/me/location` posts from this driver

## Kill-and-relaunch

- [ ] Force-quit the app from the iOS app switcher
- [ ] Relaunch — driver should be restored to the same online state and (if mid-ride) the active ride screen
- [ ] Location posting resumes within ~30 s

## Failure modes to watch for

- ❌ `location.always_plugin_unavailable` in driver logs — the custom Swift plugin isn't compiled into the App target (check `App.xcodeproj/project.pbxproj`)
- ❌ Coordinates frozen for >2 minutes with screen locked — `UIBackgroundModes` missing `location`, or the `NSLocationAlwaysAndWhenInUseUsageDescription` strings missing from Info.plist
- ❌ Server returning 401 — Supabase access token expired; the driver app should refresh it on the next request

## Sign-off

- Tester: ____________________
- Build / commit: ____________________
- Date: ____________________
- Result: pass / fail
