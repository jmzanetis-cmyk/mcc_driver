import React from 'react';
import { LegalLayout } from './LegalLayout';

export function TermsScreen() {
  return (
    <LegalLayout title="Terms of Service" subtitle="Last updated: May 16, 2026">
      <p>
        These Terms of Service ("Terms") govern your use of the{' '}
        <strong>My Car Concierge Driver</strong> mobile application provided
        by <strong>My Car Concierge, LLC</strong>. By creating an account or
        using the Driver App you agree to these Terms.
      </p>

      <h2>1. Eligibility</h2>
      <ul>
        <li>Be at least <strong>21 years old</strong>.</li>
        <li>Hold a valid U.S. driver's license.</li>
        <li>Maintain current automobile insurance meeting our minimums.</li>
        <li>Pass our background check and motor-vehicle-record review.</li>
        <li>Comply with all applicable laws.</li>
      </ul>

      <h2>2. Independent contractor relationship</h2>
      <p>You operate as an <strong>independent contractor</strong>, not as an employee, agent, joint venturer, or partner of My Car Concierge. You are solely responsible for your taxes, licensing, insurance, and the operation and maintenance of any vehicle you drive.</p>

      <h2>3. Acceptable use</h2>
      <ul>
        <li>Never drive while impaired by alcohol, drugs, or any substance affecting safe driving.</li>
        <li>Obey all traffic laws, including distracted-driving and seat-belt rules.</li>
        <li>Do not discriminate against any rider on the basis of any protected category.</li>
        <li>Do not misrepresent your identity, location, or qualifications.</li>
        <li>Do not tamper with or reverse-engineer the app.</li>
        <li>Do not harass, threaten, or harm any rider, driver, or member of the public.</li>
      </ul>

      <h2>4. Ride dispatch and acceptance</h2>
      <p>Accepting a request creates an obligation to complete that ride. Repeated declines, no-shows, or cancellations may affect dispatch priority or result in deactivation.</p>

      <h2>5. Payment and payouts</h2>
      <p>You will be paid the per-ride amount displayed at dispatch, less applicable platform or service fees. Payouts are processed by Stripe; using the Driver App also constitutes acceptance of Stripe's terms. Instant Pay is subject to a small processing fee.</p>

      <h2>6. Account suspension and termination</h2>
      <p>We may suspend or deactivate your account if we believe you have violated these Terms or any My Car Concierge policy, engaged in unsafe driving, failed a periodic background check, allowed your license, insurance, or registration to lapse, or engaged in fraud. You may delete your account from <strong>Settings → Delete Account</strong>.</p>

      <h2>7. Background checks and driving record</h2>
      <p>You authorize My Car Concierge and its screening provider to obtain consumer reports, including criminal history and motor-vehicle records, at onboarding and periodically thereafter.</p>

      <h2>8. Insurance</h2>
      <p>You must maintain personal automobile insurance meeting or exceeding the minimums set by your state and by My Car Concierge.</p>

      <h2>9. Disclaimers</h2>
      <p>The Driver App is provided <strong>"as is"</strong> and <strong>"as available"</strong>. To the fullest extent permitted by law, My Car Concierge disclaims all warranties, express or implied.</p>

      <h2>10. Limitation of liability</h2>
      <p>To the fullest extent permitted by law, in no event will My Car Concierge be liable for any indirect, incidental, special, consequential, or punitive damages. Our total liability for any claim will not exceed the greater of (a) the amount you earned through the Driver App in the three (3) months preceding the event, or (b) one hundred U.S. dollars ($100).</p>

      <h2>11. Indemnification</h2>
      <p>You agree to indemnify and hold harmless My Car Concierge and its affiliates from claims arising from your use of the Driver App, your breach of these Terms, your violation of any law, or your infringement of any third-party right.</p>

      <h2>12. Dispute resolution and arbitration</h2>
      <p>Any dispute will be resolved by <strong>binding individual arbitration</strong> under the rules of the American Arbitration Association, in Florida. You and My Car Concierge each waive the right to a jury trial and to participate in a class action. You may opt out within 30 days of first accepting these Terms by emailing <strong>legal@mycarconcierge.com</strong> with the subject "Arbitration Opt-Out."</p>

      <h2>13. Governing law</h2>
      <p>These Terms are governed by the laws of the State of Florida.</p>

      <h2>14. Changes to these Terms</h2>
      <p>We will notify you in-app of material changes and update the "Last updated" date above.</p>

      <h2>15. Contact</h2>
      <p>
        <strong>My Car Concierge, LLC</strong><br />
        Legal: legal@mycarconcierge.com<br />
        Support: support@mycarconcierge.com
      </p>
    </LegalLayout>
  );
}
