# App Store Connect — App Privacy Worksheet

Use this document when filling out the **App Privacy** section in App
Store Connect for the My Car Concierge Driver app. Each row maps a
category in App Store Connect to the data the Driver App actually
collects.

## Summary

- Does the app collect data? **Yes**
- Is data used for **third-party advertising**? **No**
- Is data used for **developer's advertising or marketing**? **No**
- Is data used for **analytics**? **Yes** (first-party diagnostics only)
- Is data used for **product personalization**? **No**
- Is data used for **app functionality**? **Yes**
- Is data linked to the user's identity? **Yes** (see per-category notes)
- Is data used for **tracking** (as defined by App Tracking
  Transparency)? **No**

## Data categories collected

For every row below, _Linked to user_ = **Yes** unless otherwise
noted, and _Used for tracking_ = **No** for every row.

### Contact info

| Data type | Purpose | Linked |
|-----------|---------|--------|
| Name | App functionality, customer support | Yes |
| Email address | App functionality, customer support | Yes |
| Phone number | App functionality (sign-in via SMS OTP) | Yes |

### Identifiers

| Data type | Purpose | Linked |
|-----------|---------|--------|
| User ID (Supabase auth UUID) | App functionality | Yes |
| Device ID (APNs token) | App functionality (push notifications) | Yes |

### Financial info

| Data type | Purpose | Linked |
|-----------|---------|--------|
| Payment info (bank / debit card last 4) | App functionality (payouts) | Yes |
| Other financial info (payout amounts, earnings history) | App functionality | Yes |

### Location

| Data type | Purpose | Linked |
|-----------|---------|--------|
| Precise location | App functionality (ride dispatch eligibility, live navigation, pickup ETA) | Yes |

> The Driver App requests **While Using the App** location at first
> sign-in and may upgrade to **Always Allow** during an active ride
> (iOS prompts the user automatically).

### Sensitive info

| Data type | Purpose | Linked |
|-----------|---------|--------|
| Government ID number (driver's license) | App functionality (background check, regulatory compliance) | Yes |

### User content

| Data type | Purpose | Linked |
|-----------|---------|--------|
| Photos (profile photo, license image, insurance image) | App functionality | Yes |
| Customer support messages | App functionality | Yes |

### Usage data

| Data type | Purpose | Linked |
|-----------|---------|--------|
| Product interaction (ride accept/decline events, stage transitions) | Analytics, App functionality | Yes |

### Diagnostics

| Data type | Purpose | Linked |
|-----------|---------|--------|
| Crash data | Analytics | Yes |
| Performance data | Analytics | Yes |

## Data NOT collected

For clarity, we do **not** collect any of the following App Store
Connect categories: Health & Fitness, Browsing History, Search
History, Contacts (address book), Audio Data, Gameplay Content,
Customer Support transcripts beyond user-initiated messages,
Advertising Data, or Other Data Types not listed above.

## Tracking declaration

We do not link any of the data above to data collected by other
companies' apps, websites, or offline properties for advertising or
advertising measurement purposes, and we do not share user or
device data with data brokers. Therefore the app's **App Tracking
Transparency** prompt is **not required** and we declare "Data Not
Used to Track You" in App Store Connect.
