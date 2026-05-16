# App Review — Sign-in Information & Demo Notes

Paste the body of this file into App Store Connect →
**App Information → App Review Information → Notes**.
The phone number + OTP go into the **Sign-In Information** fields
above the Notes box (those are separate inputs).

---

**Sign-In Information**

- Phone number: `+15555550199`
- Verification code: `424242`

(These are pre-configured as a Supabase Auth "Test Phone Number"
specifically for App Review — no real SMS is sent. Restart the app
between login attempts if needed.)

---

**Notes for the Reviewer**

Thanks for reviewing MCC Driver! MCC Driver is the driver-facing app
for My Car Concierge, a premium vehicle concierge service. Drivers
sign in, receive dispatched ride requests, and complete the ride
lifecycle from pickup to drop-off.

The reviewer account above is pre-approved (the real driver experience
includes a background-check step that we have already cleared for you),
so you can begin using the app immediately after signing in.

**How to test the core feature (dispatched ride flow):**

1. Sign in with the phone number above. When the SMS code field
   appears, enter `424242` (no real text message is sent — this is a
   Supabase test number reserved for App Review).
2. You will land on the Home screen. Tap the large toggle to **go
   online**. Allow location permission when prompted ("While Using
   the App" is sufficient for testing).
3. **Email** us at `appreview@mycarconcierge.com` from the reviewer
   address provided in App Store Connect, or use the in-app Support
   link (Settings → Support), and we will manually dispatch a test
   ride to the reviewer account within minutes during business hours
   (9am–6pm Pacific, Mon–Fri). The reviewer line is monitored.
4. A ride-offer modal will appear with a 30-second countdown. Tap
   **Accept**.
5. Step through the active-ride stages by tapping the primary action
   button at the bottom: "I'm en route" → "I've arrived" → "Start
   ride" → "Complete ride". Each stage is a tap; no real driving is
   required.
6. After completion, the Earnings tab will show the test ride.

**Why a live dispatch is needed:** the entire purpose of the app is
receiving real-time ride requests, which are sent by our dispatch
system. We coordinate the test dispatch by email/SMS so we can target
the reviewer device specifically and avoid sending a real driver out.

**Permissions explained:**

- **Location (While Using / Always)**: drivers must share live
  location so we can match them to nearby ride requests. "Always" is
  only requested after a ride is accepted so iOS can keep the route
  updating with the screen locked.
- **Notifications**: drivers must receive ride offers in real time
  even when the app is backgrounded.
- **Camera / Photo Library**: optional — only used during the
  background-check application flow (not relevant for the pre-approved
  reviewer account).

**Account deletion (5.1.1(v)):** Settings → "Delete Account". This
permanently anonymizes the driver record and removes the Supabase auth
user (see in-app screen for full disclosure). You can re-register the
same phone immediately afterward.

**Privacy / Terms / Support:** linked from the sign-in footer and
from Settings → Legal & About. Also reachable at
`/legal/privacy`, `/legal/terms`, `/legal/support`.

Contact for any questions: `appreview@mycarconcierge.com`.
