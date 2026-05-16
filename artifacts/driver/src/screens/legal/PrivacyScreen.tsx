import React from 'react';
import { LegalLayout } from './LegalLayout';

export function PrivacyScreen() {
  return (
    <LegalLayout title="Privacy Policy" subtitle="Last updated: May 16, 2026">
      <p>
        This Privacy Policy explains how <strong>My Car Concierge, LLC</strong>{' '}
        ("My Car Concierge," "we," "us," or "our") collects, uses, shares, and
        protects information when you use the <strong>My Car Concierge Driver</strong>{' '}
        mobile application (the "Driver App").
      </p>

      <h2>1. Information we collect</h2>
      <ul>
        <li><strong>Account &amp; identity</strong> — your name, phone number, email address, and a government-issued ID number used solely to run a background check.</li>
        <li><strong>Driving credentials</strong> — driver's license image, vehicle insurance document, and the data extracted from those documents.</li>
        <li><strong>Banking &amp; payout information</strong> — the last four digits of the bank account or debit card you connect through our payments processor. Full account numbers are stored only by our payments processor, never on our servers.</li>
        <li><strong>Location data</strong> — your device's precise geographic location, both while the app is in use and in the background during an active ride.</li>
        <li><strong>Ride history &amp; earnings</strong> — every ride you receive, accept, decline, complete, or cancel, with fares, timestamps, addresses, and payout amounts.</li>
        <li><strong>Device &amp; push token</strong> — a device identifier and Apple Push Notification token so we can deliver ride and payout notifications.</li>
        <li><strong>Support communications</strong> — messages you send to our in-app AI assistant or human support.</li>
        <li><strong>Diagnostic logs</strong> — crash reports and basic performance telemetry.</li>
      </ul>

      <h2>2. How we use information</h2>
      <p>To verify your identity, run a background check, match you with rides, power navigation, process payouts, send transactional notifications, respond to support requests, investigate fraud or safety incidents, and comply with legal obligations.</p>
      <p>We do <strong>not</strong> use your data for advertising or for tracking you across unrelated apps or websites.</p>

      <h2>3. Third parties we share with</h2>
      <table>
        <thead>
          <tr><th>Provider</th><th>Purpose</th><th>Data shared</th></tr>
        </thead>
        <tbody>
          <tr><td>Supabase, Inc.</td><td>Database, authentication, realtime</td><td>Account, ride, location, documents</td></tr>
          <tr><td>Stripe, Inc.</td><td>Payouts</td><td>Bank/debit details, payout amounts, tax info</td></tr>
          <tr><td>Twilio, Inc.</td><td>SMS verification and ride notifications</td><td>Phone number, ride event metadata</td></tr>
          <tr><td>Apple (APNs)</td><td>Push notifications</td><td>Device token, notification payload</td></tr>
          <tr><td>BackgroundChecks.com</td><td>Background check</td><td>Name, DOB, license number, government ID</td></tr>
          <tr><td>Resend, Inc.</td><td>Transactional email</td><td>Email address, message content</td></tr>
        </tbody>
      </table>
      <p>We do not sell your personal information and do not share with data brokers or ad networks.</p>

      <h2>4. Location data — special notice</h2>
      <p>The Driver App requests <strong>While Using the App</strong> location when you first go online. After you accept a ride, iOS may prompt you to upgrade to <strong>Always Allow</strong> so we can keep tracking during the ride with the screen locked. Background location is used only during an active ride and stops immediately when the ride ends or is cancelled.</p>

      <h2>5. Data retention</h2>
      <p>Active driver records are retained as long as your account is active. After account deletion, your personal profile is anonymized within minutes; ride records, payout records, and audit logs are retained for accounting, tax, and safety purposes for up to <strong>seven (7) years</strong> as required by applicable law.</p>

      <h2>6. Your rights</h2>
      <p>You may have the right to access, correct, delete, or port your personal information. Email <strong>privacy@mycarconcierge.com</strong> and we will respond within 30 days.</p>

      <h2>7. Account deletion</h2>
      <p>You can permanently delete your account from <strong>Settings → Delete Account</strong>. A two-step confirmation is required. Deletion is blocked while you have an active ride, pending payout, or unpaid earned balance so no money owed to you is lost.</p>

      <h2>8. Children</h2>
      <p>The Driver App is intended only for users aged 21 and over and is not directed at children.</p>

      <h2>9. Security</h2>
      <p>We use TLS in transit, encryption at rest, role-based access controls, and audit logging for sensitive operations.</p>

      <h2>10. Changes to this policy</h2>
      <p>We will notify you in-app of material changes and update the "Last updated" date above.</p>

      <h2>11. Contact us</h2>
      <p>
        <strong>My Car Concierge, LLC</strong><br />
        Privacy: privacy@mycarconcierge.com<br />
        Support: support@mycarconcierge.com
      </p>
    </LegalLayout>
  );
}
