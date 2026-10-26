import { useEffect } from "react";
import { Link } from "react-router-dom";

export default function CancellationRefundPolicyPage() {
  useEffect(() => {
    document.title = "Cancellation and Refund Policy — Simple Talk";
  }, []);

  return (
    <main className="legal">
      <p className="kicker">Legal</p>
      <h1>Cancellation and Refund Policy</h1>
      <p className="meta">Last updated: 25 October 2026</p>
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

      <h2>1. Nature of the Service and Prepaid Balance</h2>
      <p>
        Simple Talk is an intermediary marketplace that facilitates live audio and video sessions between
        fans and independent creators. When you add money to your spendable balance, it is a <strong>prepayment
        for future live sessions and gifts</strong>. It is processed by an external payment gateway. It is
        <strong>not a bank deposit</strong>, and it is <strong>not a digital good or in-app currency</strong> for media or content.
      </p>

      <h2>2. No Automatic Refunds on Recharges</h2>
      <p>
        Once a recharge is completed and the spendable balance is credited to your account,
        <strong>the amount cannot be automatically refunded, withdrawn, or transferred back to your original payment method.</strong>
        The balance is committed to settling live sessions and gifts with independent creators on the platform.
      </p>
      <p>
        This is because the platform uses external payment gateways that charge processing fees on both
        the deposit and any reversal, and the funds are immediately earmarked for settlement with creators
        who make themselves available for calls.
      </p>

      <h2>3. Completed Sessions Are Not Refundable</h2>
      <p>
        Time that was live on a call, and gifts that were delivered during a live call, <strong>are not refunded</strong>,
        because the creator's time has already been given. The platform records the session duration and
        gift delivery, and settlement occurs in real time.
      </p>

      <h2>4. Unanswered, Declined, or Cancelled Rings</h2>
      <p>
        A ring that is declined, cancelled, or missed by the creator <strong>does not create a completed charge</strong>.
        No minutes are deducted from your spendable balance. This protects both the fan's balance and
        the creator's choice not to answer.
      </p>

      <h2>5. Failed Settlement — Contact for Review</h2>
      <p>
        If a recharge payment is charged by your bank or payment instrument but the wallet is <strong>not credited</strong>
        on Simple Talk, you may request a review. Write to <a href="mailto:gambiraojas6@gmail.com">gambiraojas6@gmail.com</a>
        with the following details:
      </p>
      <ul>
        <li>Registered mobile number on the account</li>
        <li>Payment reference / transaction ID from your bank or payment app</li>
        <li>Date and approximate time of the recharge attempt</li>
        <li>Amount charged</li>
      </ul>
      <p>
        Each case is reviewed individually. If the gateway confirms the funds were received by the platform
        but not credited, the balance will be added to your spendable wallet.
      </p>

      <h2>6. Exceptional Circumstances — Request a Refund Review</h2>
      <p>
        In exceptional cases (e.g., a technical failure that prevented a session from starting despite a
        confirmed connection, or a verified platform error), you may request a refund review by contacting
        support. The platform does not guarantee a refund, but every request is reviewed.
      </p>
      <p>
        To submit a refund request, email <a href="mailto:gambiraojas6@gmail.com">gambiraojas6@gmail.com</a>
        or call <a href="tel:+919492045797">+91 94920 45797</a> with:
      </p>
      <ul>
        <li>Your registered mobile number</li>
        <li>Session ID or date/time of the affected call</li>
        <li>A clear description of the issue</li>
        <li>Any screenshots or evidence, if applicable</li>
      </ul>
      <p className="note">
        Refund requests must be made within 7 days of the session or recharge. Requests outside this window
        may not be considered. The platform's decision on refund requests is final.
      </p>

      <h2>7. Creator Payouts Are Separate</h2>
      <p>
        A creator's earnings balance is separate from a fan's spendable balance. Creator earnings are
        remitted to the creator's UPI ID after review. Fans cannot spend, transfer, or request a refund
        of creator earnings.
      </p>
      <p>
        A 10% withdrawal commission is deducted from the gross amount requested. The creator receives the
        remaining 90%. If the creator was referred by another creator, 5% of the gross withdrawal is paid
        to the referrer and the platform retains 5%; otherwise the platform retains the full 10%. If the
        referred creator or the referrer has deleted their account before the payout is settled, no
        referral share is payable and the platform retains the full 10%. The withdrawal commission is a
        service charge and is not refundable after the payout is marked paid.
      </p>

      <h2>8. Referral Bonuses</h2>
      <p>
        Friend-invite bonuses credited to a fan's spendable balance are promotional credits. They are not
        refundable, not transferable, and cannot be withdrawn as cash. They can only be used to pay for
        live sessions and gifts on the platform.
      </p>
      <p>
        Creator-to-creator referral bonuses are 5% of the gross withdrawal amount of a referred creator,
        paid from the 10% withdrawal commission. They are credited to the referrer's earnings balance and
        are treated as creator earnings. They follow the same payout review, minimum withdrawal, and
        settlement rules as other creator earnings and are not a refundable charge.
      </p>

      <h2>9. Legal Jurisdiction</h2>
      <p>
        This policy is governed by the laws of India. Disputes about the platform are subject to the
        exclusive jurisdiction of the courts in Hyderabad, except where the law does not allow that limit.
      </p>

      <h2>10. Contact</h2>
      <p>For questions about cancellations, refunds, or failed recharges, contact:</p>
      <p>
        <strong>Email:</strong> <a href="mailto:gambiraojas6@gmail.com">gambiraojas6@gmail.com</a>
        <br />
        <strong>Phone:</strong> <a href="tel:+919492045797">+91 94920 45797</a>
        <br />
        <strong>Owner:</strong> Gandapodi V Saathvik
      </p>
      <p className="meta">Last updated: 26 October 2026. This policy is subject to change.</p>
    </main>
  );
}