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
      <p className="notice">
        These terms can change at any time. The date above is updated and the new text replaces the
        previous version on this page and in the app. Continued use after a change is acceptance. If you
        do not accept the new terms, stop using Simple Talk and request deletion on the{" "}
        <Link to="/delete-account">account deletion</Link> page.
      </p>

      <h2>1. Intermediary marketplace disclaimer</h2>
      <p>
        Simple Talk, owned by <strong>Gandapodi V Saathvik</strong>, is a technology marketplace and
        intermediary. It connects a user with an independent service provider (a creator, model, or
        consultant) for a live audio or video interaction. We act only as the bridge. We do not:
      </p>
      <ul>
        <li>Provide digital content, a recording, media access, or virtual goods.</li>
        <li>Control the advice, conversation, or other interaction during a session.</li>
        <li>Accept liability for the quality, legality, or outcome of a session.</li>
      </ul>
      <p>
        The service relationship is directly between the user and the creator. Simple Talk provides the
        connection and the settlement of the prepaid fee. We are not the creator’s employer, agent, or
        partner.
      </p>

      <h2>2. Acceptance</h2>
      <p>
        By accessing Simple Talk, creating an account, recharging, placing or accepting a call, sending
        a gift, or requesting a withdrawal, you agree to these terms and to the{" "}
        <Link to="/privacy">Privacy Policy</Link>. You must be 18 or older.
      </p>

      <h2>3. Account responsibilities</h2>
      <p>
        You are responsible for the security of your phone number, one-time passwords, and profile, and
        for every call, recharge, gift, and withdrawal made through your account. Profile details must
        be accurate. Creators must complete verification, including a live selfie, before taking paid
        calls. Approval can be refused or withdrawn.
      </p>

      <h2>4. Marketplace rules</h2>
      <p>
        Users and creators must keep the session lawful. Trying to bypass Simple Talk’s settlement —
        including taking the fee off the platform to avoid the facilitation charge — is a breach of
        these terms. We may warn, restrict, suspend, or permanently close an account, remove material,
        delay or forfeit pending earnings where the law allows, keep records, and share them with the
        payment partner or a lawful authority. A report does not make us responsible for what already
        happened on the call.
      </p>

      <h2>5. Live sessions</h2>
      <p>Simple Talk facilitates a real-time, one-to-one session:</p>
      <ul>
        <li><strong>Nature of the service.</strong> The session is led by two people. It is not pre-recorded content and it is not an automated service.</li>
        <li><strong>Channels.</strong> Audio or video is available only while the call is live.</li>
        <li><strong>Settlement.</strong> The fee follows the per-minute rate published by the independent creator. Billing starts when the call is live. A declined, cancelled, or missed ring is not a completed paid session.</li>
        <li><strong>Gifts.</strong> A gift during a live call is a gratuity for that session. It is non-refundable once delivered, and it is settled net of the facilitation fee.</li>
        <li><strong>Availability.</strong> Creators appear as available, on a call, do not disturb, or offline. Only one incoming ring is placed at a time. Simple Talk does not book a future appointment, send a reminder, or keep a wait-list.</li>
      </ul>

      <h2>6. Prepaid balance</h2>
      <p>By adding money to your balance, you agree:</p>
      <ul>
        <li><strong>Purpose.</strong> The balance is a prepayment used to settle live sessions and gifts with independent creators.</li>
        <li><strong>Not a digital good.</strong> The balance is not in-app currency for media or content. It is held to settle a live human session.</li>
        <li><strong>Use.</strong> Recharged amounts are committed to sessions on Simple Talk. They are not a bank deposit and they are not transferable to another person, except through the referral rules in the app.</li>
        <li><strong>Creator earnings.</strong> A creator’s earnings are a separate balance and are remitted to UPI after review. Fans cannot spend that balance.</li>
      </ul>

      <h2>7. Facilitation fees and external settlement</h2>
      <h3>7.1. Recharge and settlement</h3>
      <ul>
        <li><strong>Gateway.</strong> Recharges are collected by an external payment gateway. We receive the order status, not your card or UPI PIN.</li>
        <li><strong>Separate balances.</strong> The user’s spendable credit and the creator’s earnings are settled separately, which is how this marketplace pays an independent provider.</li>
        <li><strong>Facilitation fee.</strong> Simple Talk retains 15% of call charges and gifts for connectivity and settlement. The creator receives about 85%.</li>
      </ul>
      <h3>7.2. Session billing</h3>
      <ul>
        <li><strong>Rates.</strong> The creator sets the audio rate and the video rate. The platform times the live session.</li>
        <li><strong>Settlement.</strong> Minutes are deducted from the spendable balance while the call is live. A low balance can end the call. A short reconnect window may apply if the connection drops.</li>
      </ul>
      <h3>7.3. Refunds and disputes</h3>
      <ul>
        <li><strong>Completed time and gifts.</strong> Time that was live, and gifts that were delivered, are not refunded, because the creator’s time has already been given.</li>
        <li><strong>Failed settlement.</strong> If a recharge is charged and the wallet is not credited, write to gambiraojas6@gmail.com with the mobile number and the payment reference. That case is reviewed individually.</li>
        <li><strong>Unanswered calls.</strong> A ring that is declined, cancelled, or missed does not create a completed charge. That protects both the fan’s balance and the creator’s choice not to answer.</li>
      </ul>

      <h2>8. Content and conduct</h2>
      <p>
        Users and creators must keep sessions lawful. The platform prohibits illegal content, scams,
        harassment, impersonation, sexual content involving anyone under 18, and anything else that
        cannot lawfully be part of a live session. Creators are solely responsible for what they offer
        on a call and for tax on their earnings. Users are solely responsible for what they say and for
        whom they choose to call.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        Simple Talk is a facilitator of a live interaction. We are not liable for the advice, conduct,
        promises, recordings, or results of any session, or for contact or payment that two people
        arrange outside the app. To the extent the law allows, our total liability for a claim about the
        platform itself is limited to the amount you paid us in the three months before the claim, or
        unpaid creator earnings still owed to you, whichever is greater. Nothing here removes a liability
        the law does not allow us to remove.
      </p>
      <p>
        If a claim is brought against Simple Talk or Gandapodi V Saathvik because of your session, your
        profile, your fraud, or your breach of these terms, you will cover the resulting losses and
        reasonable costs, to the extent the law allows.
      </p>

      <h2>10. Law and jurisdiction</h2>
      <p>
        These terms are governed by the laws of India. Disputes about the platform are subject to the
        exclusive jurisdiction of the courts in Hyderabad, except where the law does not allow that limit.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may change these terms, the facilitation fee, referral amounts, the minimum withdrawal, or
        parts of the product. A change is posted with a new date. The published version is the one that
        applies. Continued use is acceptance.
      </p>

      <h2>12. Contact</h2>
      <p>
        <strong>Email:</strong> <a href="mailto:gambiraojas6@gmail.com">gambiraojas6@gmail.com</a>
        <br />
        <strong>Owner:</strong> Gandapodi V Saathvik
      </p>
      <p>
        Account deletion: <Link to="/delete-account">request deletion</Link>.
      </p>
      <p className="meta">Last updated: 2 October 2026. These terms are subject to change.</p>
    </main>
  );
}
