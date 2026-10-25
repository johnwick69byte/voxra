import { useEffect } from "react";
import { Link } from "react-router-dom";

export default function ContactPage() {
  useEffect(() => {
    document.title = "Contact — Simple Talk";
  }, []);

  return (
    <main className="legal">
      <p className="kicker">Contact</p>
      <h1>Get in touch</h1>
      <p className="meta">Simple Talk is owned by <strong>Gandapodi V Saathvik</strong>.</p>

      <section className="contact-section">
        <h2>Support & questions</h2>
        <p>
          For account issues, billing questions, privacy concerns, or any other inquiries,
          you can reach us at:
        </p>
        <ul className="contact-list">
          <li>
            <strong>Email:</strong>
            <a href="mailto:gambiraojas6@gmail.com">gambiraojas6@gmail.com</a>
          </li>
          <li>
            <strong>Phone:</strong>
            <a href="tel:+919492045797">+91 94920 45797</a>
          </li>
        </ul>
        <p className="note">
          Please include your registered mobile number and a brief description of the issue
          so we can assist you faster.
        </p>
      </section>

      <section className="contact-section">
        <h2>Legal & compliance</h2>
        <ul className="contact-links">
          <li>
            <Link to="/cancellation-refund-policy">Cancellation & Refund Policy</Link>
          </li>
          <li>
            <Link to="/privacy">Privacy Policy</Link>
          </li>
          <li>
            <Link to="/terms">Terms and Conditions</Link>
          </li>
          <li>
            <Link to="/delete-account">Account Deletion</Link>
          </li>
        </ul>
      </section>

      <section className="contact-section">
        <h2>Owner</h2>
        <p>
          <strong>Gandapodi V Saathvik</strong><br />
          Simple Talk
        </p>
      </section>
    </main>
  );
}