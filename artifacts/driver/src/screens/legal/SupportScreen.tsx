import React from 'react';
import { LegalLayout } from './LegalLayout';

export function SupportScreen() {
  return (
    <LegalLayout title="Driver Support" subtitle="We're here whenever you need us.">
      <h2>Contact us</h2>
      <ul>
        <li><strong>Email:</strong> support@mycarconcierge.com — within 1 business hour during operating hours, otherwise by next morning.</li>
        <li><strong>Phone:</strong> 1-800-555-MCC1 (1-800-555-6221) — 6 AM to midnight Eastern, seven days a week.</li>
        <li><strong>In-app:</strong> open the AI assistant from <strong>Home → Support</strong> for instant policy and how-to answers.</li>
      </ul>

      <h2>Common questions</h2>

      <h3>How do I get approved as a driver?</h3>
      <p>Sign up with your phone number, then complete the application form (profile, license, insurance). We run a background check through our screening partner; approval typically takes 2–3 business days.</p>

      <h3>How do I receive ride requests?</h3>
      <p>Tap <strong>Go Online</strong> on the Home screen. Eligible ride requests appear as a full-screen modal with the fare, pickup, drop-off, and a countdown timer. Tap <strong>Accept</strong> to take the ride or <strong>Decline</strong> to pass.</p>

      <h3>How are payouts handled?</h3>
      <p>Earnings are paid out automatically every week to the bank account you connect under Settings → Payments. You can also tap <strong>Instant Pay</strong> in the Earnings screen to cash out your available balance immediately for a small fee.</p>

      <h3>How do I update my insurance or license document?</h3>
      <p>Go to <strong>Settings → Documents</strong> and re-upload. We review updates within one business day.</p>

      <h3>How do I delete my account?</h3>
      <p>Open <strong>Settings → Delete Account</strong> and follow the two-step confirmation. Your profile is anonymized immediately; ride history and payout records are retained as required for accounting.</p>

      <h3>My ride request didn't reach me — what happened?</h3>
      <p>Make sure you are online, location services are enabled ("While Using" or "Always"), and notifications are allowed for the My Car Concierge Driver app in iOS Settings. If the issue persists, contact support with the time and your driver ID.</p>
    </LegalLayout>
  );
}
