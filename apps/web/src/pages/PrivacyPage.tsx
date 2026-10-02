import { useEffect } from "react";

export default function PrivacyPage() {
  useEffect(() => {
    document.title = "Privacy Policy — Simple Talk";
  }, []);

  return (
    <main className="legal">
      <p className="kicker">Legal</p>
      <h1>Privacy Policy</h1>
      <p className="meta">Last updated: 2 October 2026</p>
      <p>
        Simple Talk (“we”, “us”) operates an instant audio and video calling service between fans and
        creators. This policy explains what we collect, why we collect it, who helps us process it, and
        how you can ask us to delete your account. We do not sell personal data.
      </p>

      <h2>Who this covers</h2>
      <p>
        This policy applies to the Simple Talk mobile app (Android package and iOS bundle{" "}
        <strong>com.simple_talk.app</strong>) and to the websites and APIs that support it. You must be
        18 or older to use the service. The service is owned by Gandapodi V Saathvik.
      </p>

      <h2>Data we collect</h2>
      <ul>
        <li>
          <strong>Account.</strong> Phone number used for one-time password login, name, username,
          profile photo, bio, and whether you use the app as a fan or a creator.
        </li>
        <li>
          <strong>Creator verification.</strong> A live selfie captured during creator onboarding, plus
          the audio and video rates you publish and your availability status.
        </li>
        <li>
          <strong>Device and notifications.</strong> Push notification tokens, basic device information
          needed to deliver calls and account alerts, and app version information used to require updates.
        </li>
        <li>
          <strong>Calls.</strong> Who called whom, audio or video, start and end time, duration,
          per-minute rates, status, disconnect reasons, and ratings or reports you submit after a call.
        </li>
        <li>
          <strong>Wallet and payouts.</strong> Spendable balance, creator earnings balance, recharge
          order identifiers, gift amounts, commission applied, withdrawal requests, and the UPI ID you
          submit for payouts.
        </li>
        <li>
          <strong>Referrals.</strong> Your referral code, codes you apply, and whether a first-recharge
          bonus has already been paid.
        </li>
        <li>
          <strong>Support.</strong> Messages you send from the in-app support form.
        </li>
      </ul>
      <p>
        Microphone and camera are used only while you are in a call, and only after the operating system
        has granted permission. We do not store a recording of your call. The other person on the call
        may still capture the conversation with their own device outside our control.
      </p>

      <h2>How we use data</h2>
      <ul>
        <li>Authenticate you with a phone OTP and keep you signed in.</li>
        <li>Show creator profiles, availability, and rates, and route an instant call.</li>
        <li>Bill prepaid minutes and gifts, credit creator earnings after the platform commission, and process withdrawals.</li>
        <li>Send call, account, and availability notifications.</li>
        <li>Detect fraud, abuse, duplicate accounts, and payment problems.</li>
        <li>Respond to support requests and enforce our terms.</li>
      </ul>

      <h2>Call privacy controls</h2>
      <p>
        The in-call screen blocks screenshots and screen recording where the operating system allows it.
        That control reduces casual capture. It does not stop a second camera, a second phone, or software
        that bypasses the operating system. Before your first call we ask you to confirm that you are 18
        or older and that the other participant may record.
      </p>

      <h2>Processors</h2>
      <p>Service providers process data only to run Simple Talk:</p>
      <ul>
        <li>SMS one-time passwords.</li>
        <li>Cloud database and cache.</li>
        <li>Push notifications.</li>
        <li>Live audio and video transport.</li>
        <li>Profile photo and media hosting.</li>
        <li>Payment collection for wallet recharges.</li>
      </ul>
      <p>Media for a live call is transported for the session and is not stored by us as a recording.</p>

      <h2>Sharing</h2>
      <p>
        Other users see the profile fields you publish: name, username, photo, bio, rates, and
        availability. We share data with the processors above, with payment and payout partners as needed
        to complete a transaction, and when the law requires it. We do not sell personal data.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        You can request account deletion from Profile in the app. We deactivate the account and schedule
        removal of personal identifiers. We may keep limited records for fraud prevention, unpaid or
        disputed payouts, tax, or other legal duties.
      </p>

      <h2>Children</h2>
      <p>Simple Talk is not for anyone under 18. We do not knowingly create accounts for minors.</p>

      <h2>Contact</h2>
      <p>
        For privacy requests, use support from the in-app Profile section. Include the phone number on
        the account so we can find it.
      </p>
    </main>
  );
}
