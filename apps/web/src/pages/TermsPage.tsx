import { useEffect } from "react";
import { Link } from "react-router-dom";

export default function TermsPage() {
  useEffect(() => {
    document.title = "Terms and Conditions — Simple Talk";
  }, []);

  return (
    <main className="legal">
      <p className="kicker">Legal</p>
      <h1>Terms and Conditions</h1>
      <p className="meta">Last updated: 2 October 2026</p>
      <p>
        These terms govern your use of Simple Talk, owned by Gandapodi V Saathvik. By creating an
        account or placing a call, recharge, gift, or withdrawal, you agree to these terms and to the{" "}
        <Link to="/privacy">Privacy Policy</Link>.
      </p>

      <h2>The service</h2>
      <p>
        Simple Talk lets a fan start a prepaid audio or video call with a creator who is available, and
        lets a creator earn from those minutes and from gifts sent during a live call. The app is not a
        messaging product and does not offer scheduled appointments.
      </p>

      <h2>Eligibility and accounts</h2>
      <ul>
        <li>You must be 18 or older.</li>
        <li>You sign in with a phone number and a one-time password. You are responsible for activity on that number.</li>
        <li>Profile information must be accurate and must not impersonate someone else.</li>
        <li>Creators must finish verification, including a live selfie, and wait for approval before taking calls.</li>
        <li>We may suspend or close accounts for fraud, harassment, illegal content, or other violations.</li>
      </ul>

      <h2>Calls</h2>
      <ul>
        <li>A fan can call a creator who is available and not already on a call.</li>
        <li>Published per-minute rates are shown before the call starts.</li>
        <li>Billing starts when the call becomes live. Minutes are prepaid from the fan’s spendable wallet.</li>
        <li>A low balance can end the call. A short reconnect window may apply if the connection drops.</li>
        <li>Decline, cancel, and no-answer do not create a completed paid session.</li>
        <li>You must not record or publish the other person where that is illegal.</li>
      </ul>

      <h2>Gifts</h2>
      <p>
        Gifts are optional one-time transfers during a live call. They are non-refundable once delivered.
        Creator credit is the gift amount after the platform commission.
      </p>

      <h2>Wallet, commission, and withdrawals</h2>
      <ul>
        <li>Recharges buy prepaid spendable credits for calls and gifts. They are not a bank deposit.</li>
        <li>Creator earnings are a separate balance.</li>
        <li>The current platform commission is 15%, so the creator receives about 85%.</li>
        <li>Withdrawals require a valid UPI ID, are subject to review, and start at ₹100.</li>
      </ul>

      <h2>Referrals</h2>
      <p>
        A bonus is paid once, after the invited person completes a first successful recharge: ₹25
        spendable for the referrer and ₹20 spendable for the new user. Self-referral and fake accounts
        can void bonuses.
      </p>

      <h2>Acceptable use</h2>
      <p>
        You will not use Simple Talk for illegal activity, scams, harassment, sexual content involving
        anyone under 18, or to misrepresent who you are. We are not liable for what users say or show on
        a call.
      </p>

      <h2>Liability</h2>
      <p>
        The service is provided as available. Network conditions and device permissions can affect call
        quality. To the extent the law allows, liability for a claim is limited to the amount you paid
        in the three months before the claim, or unpaid earnings still owed to you, whichever is greater.
      </p>

      <h2>Contact</h2>
      <p>Questions go through support in the Profile section of the app. Include the phone number on the account.</p>
    </main>
  );
}
