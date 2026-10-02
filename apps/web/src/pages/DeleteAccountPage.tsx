import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { API_BASE } from "../config";

const EMPTY = {
  phoneNumber: "",
  name: "",
  audioRatePerMinute: "",
  videoRatePerMinute: "",
  socialProfileLink: "",
};

export default function DeleteAccountPage() {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Request account deletion — Simple Talk";
  }, []);

  function setField(name: string, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    if (!form.phoneNumber || !form.name) {
      setError("Please fill in all required fields.");
      return;
    }
    if (!/^[6-9]\d{9}$/.test(form.phoneNumber)) {
      setError("Enter the 10-digit mobile number used to log in.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/auth/request-account-deletion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone_number: form.phoneNumber,
          name: form.name,
          audio_rate_per_minute: form.audioRatePerMinute ? Number(form.audioRatePerMinute) : undefined,
          video_rate_per_minute: form.videoRatePerMinute ? Number(form.videoRatePerMinute) : undefined,
          social_profile_link: form.socialProfileLink || undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { success?: boolean; detail?: string; message?: string };
      if (!response.ok || data.success === false) {
        const detail = typeof data.detail === "string" ? data.detail : "Failed to submit deletion request.";
        setError(detail);
        return;
      }
      setMessage(
        "Account deletion request submitted successfully. We will verify your details and process the deletion within 7 days if all information matches."
      );
      setForm(EMPTY);
    } catch {
      setError("Failed to submit deletion request. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="legal delete-page">
      <p className="kicker">Account</p>
      <h1>Request account deletion</h1>

      <div className="compliance">
        <p><span>Application</span> Simple Talk</p>
        <p><span>Developer</span> Gandapodi V Saathvik</p>
        <p><span>Email support</span> <a href="mailto:gambiraojas6@gmail.com">gambiraojas6@gmail.com</a></p>
      </div>

      <h2>Data safety</h2>
      <p>
        In line with Google Play’s data-deletion requirement, Simple Talk gives you this page to request
        deletion of your account and the personal data tied to it.
      </p>
      <h3>What data is deleted?</h3>
      <p>
        Your profile, call history, and wallet transaction history are removed from the production
        account. Simple Talk does not keep a chat log or a recording of the call.
      </p>
      <h3>What may be kept</h3>
      <p>
        Some records can remain for a limited time where the law requires it, including financial
        audit, fraud prevention, disputes, and tax. Those records are not used to run the account.
      </p>

      <div className="notice">
        <h2>Important notice</h2>
        <p>
          We verify the details below against the account before the deletion is scheduled. Your
          account is permanently deleted within 7 days only if the information matches the account
          records.
        </p>
        <ul>
          <li>Login mobile number (must match exactly)</li>
          <li>Name as registered on your account</li>
          <li>Call rates, if you are a creator</li>
          <li>Social profile link, if you have one</li>
        </ul>
        <p>
          Once the account is deleted, the data is removed and cannot be recovered. Wallet balances
          are transferred to the platform wallet and are not returned.
        </p>
      </div>

      <form className="delete-form" onSubmit={onSubmit}>
        <label>
          Login mobile number <em>*</em>
          <input
            name="phoneNumber"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={10}
            pattern="[0-9]{10}"
            required
            placeholder="10-digit number used to log in"
            value={form.phoneNumber}
            onChange={(event) => setField("phoneNumber", event.target.value.replace(/\D/g, "").slice(0, 10))}
          />
          <small>Enter the 10-digit mobile number used to log in.</small>
        </label>
        <label>
          Full name <em>*</em>
          <input
            name="name"
            required
            placeholder="Name exactly as it appears on your profile"
            value={form.name}
            onChange={(event) => setField("name", event.target.value)}
          />
          <small>Enter the name exactly as it appears on your profile.</small>
        </label>
        <label>
          Audio call rate per minute (₹)
          <input
            name="audioRatePerMinute"
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 8"
            value={form.audioRatePerMinute}
            onChange={(event) => setField("audioRatePerMinute", event.target.value)}
          />
          <small>Required if you are a creator. Enter your audio rate.</small>
        </label>
        <label>
          Video call rate per minute (₹)
          <input
            name="videoRatePerMinute"
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 18"
            value={form.videoRatePerMinute}
            onChange={(event) => setField("videoRatePerMinute", event.target.value)}
          />
          <small>Required if you are a creator. Enter your video rate.</small>
        </label>
        <label>
          Social profile link
          <input
            name="socialProfileLink"
            type="url"
            placeholder="https://instagram.com/yourprofile"
            value={form.socialProfileLink}
            onChange={(event) => setField("socialProfileLink", event.target.value)}
          />
          <small>Optional. A social profile link used to help verify the account.</small>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-ok">{message}</p> : null}
        <div className="hero-actions">
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : "Submit deletion request"}
          </button>
          <Link className="btn ghost" to="/">
            Cancel
          </Link>
        </div>
      </form>

      <h2>What happens after submission?</h2>
      <ol>
        <li>We verify the information against the account records.</li>
        <li>If the details match, deletion is scheduled.</li>
        <li>You can write to gambiraojas6@gmail.com if you need a status update. Include the same mobile number.</li>
        <li>The account is permanently deleted within 7 days of a successful verification.</li>
        <li>Wallet balances are transferred to the platform wallet.</li>
        <li>Personal data is removed, except records the law requires us to keep.</li>
      </ol>
    </main>
  );
}
