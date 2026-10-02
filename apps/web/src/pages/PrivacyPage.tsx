import { useEffect } from "react";
import { Link } from "react-router-dom";

export default function PrivacyPage() {
  useEffect(() => {
    document.title = "Privacy Policy — Simple Talk";
  }, []);

  return (
    <main className="legal">
      <p className="kicker">Legal</p>
      <h1>Privacy Policy</h1>
      <p className="meta">Last updated: 2 October 2026</p>
      <p className="notice">
        This policy can change at any time. The date above is updated and the new text replaces the
        previous version on this page and in the app. If you keep using Simple Talk after a change, you
        accept the updated policy. If you do not accept it, stop using the service and submit a request
        on the <Link to="/delete-account">account deletion</Link> page.
      </p>
      <p>
        Simple Talk is owned by <strong>Gandapodi V Saathvik</strong>. It is a technology bridge between
        a user (fan) and an independent creator (model). We are not a party to the call and we are not
        responsible for what either person says or does. We will still act on misuse or illegal use, as
        set out in the <Link to="/terms">Terms and Conditions</Link>.
      </p>

      <h2>1. Intermediary marketplace status</h2>
      <p>
        Simple Talk is a technology marketplace and an intermediary under the Information Technology Act,
        2000. We facilitate a live connection between users and independent service providers (creators,
        models, and consultants). Our role is limited to:
      </p>
      <ul>
        <li>Providing the technology for a live audio or video session between two people.</li>
        <li>Facilitating settlement of the service fee between the user and the provider.</li>
        <li>Showing who is available for a real-time interaction. There is no appointment calendar.</li>
        <li>Meeting intermediary due-diligence duties, including acting on reports of unlawful use.</li>
      </ul>

      <h2>2. Information we collect</h2>
      <p>We collect what is needed to open a session, settle the fee, and keep the platform safe.</p>
      <h3>2.1. Profile information</h3>
      <ul>
        <li><strong>Identity data.</strong> Name, username, and profile details shown so a user can choose whom to call.</li>
        <li><strong>Verification data.</strong> Phone number used for one-time-password sign-in. We do not require an email to create an account.</li>
        <li><strong>Visual data.</strong> Profile photo, and a live selfie used to verify a creator before they can take paid calls.</li>
      </ul>
      <h3>2.2. Settlement and financial data</h3>
      <ul>
        <li><strong>Spendable balance.</strong> Prepaid credit used to settle audio, video, and gift fees.</li>
        <li><strong>Facilitation history.</strong> Transaction logs kept for billing, disputes, and fraud checks.</li>
        <li><strong>Creator payout details.</strong> The UPI ID a creator submits, used only to remit earnings.</li>
        <li><strong>Gateway metadata.</strong> Order identifiers and payment status from the payment processor. We do not store card numbers or UPI PINs.</li>
      </ul>
      <h3>2.3. Session information</h3>
      <ul>
        <li><strong>Session logs.</strong> Who called, audio or video, start and end time, and duration, used to calculate the fee.</li>
        <li><strong>Coordination records.</strong> Call status, ratings, reports, and blocks. Simple Talk does not store a chat transcript or a recording of the call.</li>
        <li><strong>Availability and attendance.</strong> Whether a creator is available, on a call, in do-not-disturb, or offline, and whether a ring was answered, declined, missed, or cancelled. This is used for settlement. It is not a future booking.</li>
      </ul>
      <h3>2.4. Technical and device information</h3>
      <ul>
        <li><strong>Device identifiers.</strong> Push tokens and identifiers collected through Firebase Cloud Messaging and Agora so a call can ring and the live session can connect.</li>
        <li><strong>Technical metadata.</strong> App version and the device details needed to deliver the call and to require an update.</li>
        <li><strong>Phone number.</strong> Collected only to sign the account in with a one-time password and to match an account-deletion request.</li>
      </ul>

      <h2>3. How we process your data</h2>
      <p>Information is processed to:</p>
      <ul>
        <li>Connect a user with an available creator for a live session.</li>
        <li>Settle the fee between the two independent parties, including gifts sent during the call.</li>
        <li>Show live availability and the outcome of a ring. We do not run a reminder or booking calendar.</li>
        <li>Keep the platform intact, prevent unauthorized access, and investigate misuse or illegal use.</li>
      </ul>
      <p>We do not sell personal data.</p>

      <h2>4. Data security and integrity</h2>
      <p>
        Session metadata and settlement records are protected with access controls and encryption in
        transit. Access to account and payment records is limited to what is required to operate the
        service. No method of storage or transmission is perfectly secure. Do not share one-time passwords.
      </p>

      <h2>5. How live sessions are delivered</h2>
      <p>
        A Simple Talk session is a live interaction between two people. It is not a digital download, a
        recording we sell, or an automated conversation. Third parties carry the parts we do not run
        ourselves:
      </p>
      <h3>5.1. Payment settlement</h3>
      <ul>
        <li><strong>Role.</strong> An external payment gateway collects wallet recharges. Creator withdrawals are paid out to the UPI ID on the account after review.</li>
        <li><strong>Purpose.</strong> The gateway is used so the user’s prepayment and the creator’s earnings can be settled separately. The platform keeps a 15% facilitation fee. The creator receives about 85%.</li>
        <li><strong>Security.</strong> We do not store card credentials or UPI PINs. Payment status comes back to us as an order identifier and a result.</li>
      </ul>
      <h3>5.2. Live interaction — Agora</h3>
      <ul>
        <li><strong>Role.</strong> Agora provides the live audio and video channel for the session.</li>
        <li><strong>Purpose.</strong> It carries the call between the two people for as long as the session is live. We do not store that media as a recording.</li>
      </ul>

      <h2>6. Service fee settlement and remittance</h2>
      <h3>6.1. Prepayment</h3>
      <ul>
        <li><strong>Settlement balance.</strong> A recharge is a prepayment for later live sessions and gifts. It is processed by the payment gateway. It is not a bank deposit.</li>
        <li><strong>Facilitation fee.</strong> The platform retains 15% to cover technology, connectivity, dispute handling, and payment costs.</li>
      </ul>
      <h3>6.2. Creator remittance</h3>
      <ul>
        <li><strong>Disbursement.</strong> Earnings are credited after the call or gift settles, then paid to UPI after a review. The minimum withdrawal is ₹100 unless the app shows a different minimum.</li>
        <li><strong>Commission.</strong> Remittance is net of the facilitation fee described above.</li>
      </ul>

      <h2>7. Conduct and review data</h2>
      <ul>
        <li>Ratings are tied to a specific completed call so creators can be ranked.</li>
        <li>Reports and blocks are kept so we can warn, restrict, suspend, or remove an account used for misuse or illegal activity, and so we can preserve evidence where the law requires it.</li>
      </ul>

      <h2>8. Account deletion and data portability</h2>
      <p>
        You may request closure of your account at any time, without opening the app, on the{" "}
        <Link to="/delete-account">account deletion</Link> page. You can also request deletion from
        Profile while signed in.
      </p>
      <p>
        We ask for the registered mobile number and name, and, for a creator, the audio and video rates,
        so the request can be matched to the right account. If the details match, deletion is scheduled
        and completed within 7 days. Profile, call history, and wallet history are removed. Wallet
        balances are transferred to the platform wallet and are not returned. Financial records required
        for tax, fraud, or a dispute can be retained after the profile is gone.
      </p>
      <p>
        Questions about a deletion request: <a href="mailto:gambiraojas6@gmail.com">gambiraojas6@gmail.com</a>.
        Include the mobile number on the account.
      </p>

      <h2>9. Legal jurisdiction</h2>
      <p>
        This policy is governed by the laws of India. Disputes about the platform are subject to the
        exclusive jurisdiction of the courts in Hyderabad, except where the law does not allow that limit.
      </p>

      <h2>10. Contact</h2>
      <p>For privacy, deletion, or settlement questions, contact:</p>
      <p>
        <strong>Email:</strong> <a href="mailto:gambiraojas6@gmail.com">gambiraojas6@gmail.com</a>
        <br />
        <strong>Owner:</strong> Gandapodi V Saathvik
      </p>
      <p className="meta">Last updated: 2 October 2026. This policy is subject to change.</p>
    </main>
  );
}
