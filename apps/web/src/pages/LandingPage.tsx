import { useEffect } from "react";
import { Link } from "react-router-dom";

const steps = [
  {
    n: "01",
    title: "Sign in with your phone",
    body: "A one-time password creates the account. You choose fan or creator, then add a name, username, and photo.",
  },
  {
    n: "02",
    title: "Creators set a price and get approved",
    body: "A creator publishes an audio rate and a video rate, records a verification selfie, and waits for approval. After that, one switch marks them available.",
  },
  {
    n: "03",
    title: "Fans recharge, then call",
    body: "Spendable wallet credits pay for minutes and gifts. If the creator is free, the fan starts audio or video. The rate is shown before the call begins.",
  },
  {
    n: "04",
    title: "The creator answers live",
    body: "The phone rings. Accept joins the session. Decline, cancel, or no answer ends it with no completed charge. Only one caller can ring at a time.",
  },
  {
    n: "05",
    title: "Minutes and gifts settle",
    body: "Billing starts when the call is live. A low balance warning can end the session before the wallet goes negative. Gifts leave the fan’s balance immediately. The creator’s earnings are credited after the 15% platform fee.",
  },
];

const services = [
  {
    title: "Personal conversations",
    body: "Fans pay for a real conversation instead of a comment. Catch-ups, celebrations, and “I just want to talk” calls are the simplest offer.",
  },
  {
    title: "Advice and Q&A",
    body: "Career questions, study doubts, interview practice, or a focused ask-me-anything. You set how much a minute of your attention costs.",
  },
  {
    title: "Coaching sessions",
    body: "Fitness check-ins, language practice, music or content feedback, and skill coaching all fit a timed audio or video call.",
  },
  {
    title: "Consultations",
    body: "If you already advise people — styling, business, astrology, or anything else you are qualified to talk about — the call is the session.",
  },
  {
    title: "Fan access",
    body: "Creators with an audience can offer a short private call as the thing followers cannot get from a post. Followers can be notified when you go available.",
  },
  {
    title: "Gifts on top of time",
    body: "During a live call a fan can send a gift. It is a one-time thank-you, separate from the per-minute rate, and you keep about 85% of it.",
  },
];

export default function LandingPage() {
  useEffect(() => {
    document.title = "Simple Talk — Instant calls with creators";
  }, []);

  return (
    <main>
      <section className="hero">
        <div className="orb teal" />
        <div className="orb copper" />
        <div className="hero-copy">
          <p className="kicker">No inbox. No “I’ll reply later.”</p>
          <h1>Talk now. Get paid for the minute you are actually on the call.</h1>
          <p className="lede">
            Simple Talk is instant audio and video between fans and creators. If someone is available,
            you call them. You do not send a message and wait. Creators set the rate, keep about 85%
            after a 15% platform fee, and withdraw earnings to UPI.
          </p>
          <div className="hero-actions">
            <a className="btn" href="#how">
              How a call works
            </a>
            <a className="btn ghost" href="#earnings">
              See creator earnings
            </a>
          </div>
        </div>
        <div className="phone" aria-hidden="true">
          <div className="phone-bar">
            <span className="dot on" /> Available
          </div>
          <p className="phone-name">Ananya Rao</p>
          <p className="phone-meta">Audio ₹8/min · Video ₹18/min</p>
          <div className="phone-row">
            <span>You receive</span>
            <strong>~85%</strong>
          </div>
          <div className="phone-call">Incoming video call</div>
        </div>
      </section>

      <section className="section" id="waiting">
        <p className="kicker">The wait</p>
        <h2>Messages pile up. A call does not.</h2>
        <p className="sub">
          Most creator apps turn attention into a queue. Fans write, refresh, and hope. Creators open
          the app to hundreds of unpaid messages. Simple Talk removes that loop.
        </p>
        <div className="grid two">
          <article className="card dim">
            <p className="step">The old loop</p>
            <h3>Waiting to be chosen in a chat</h3>
            <ul>
              <li>A fan sends a message and has no idea when, or if, it will be read.</li>
              <li>A creator’s time disappears into replies that do not pay.</li>
              <li>The people who pay and the people who only want a free chat look the same.</li>
              <li>There is no clear end. A conversation can sit open for days.</li>
            </ul>
          </article>
          <article className="card glow">
            <p className="step">Simple Talk</p>
            <h3>If they are free, you are already talking</h3>
            <ul>
              <li>Status is visible: available, on a call, do not disturb, or offline.</li>
              <li>A ring is a yes-or-no. Accept starts the paid session. Anything else ends it.</li>
              <li>The clock is the product. Both people know the call is live and billed.</li>
              <li>When it ends, history, rating, and earnings are already recorded.</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="section alt" id="how">
        <p className="kicker">How the app works</p>
        <h2>From login to payout.</h2>
        <div className="steps">
          {steps.map((step) => (
            <article key={step.n} className="card">
              <p className="step">{step.n}</p>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section" id="fans">
        <p className="kicker">For fans</p>
        <h2>You get the conversation, not a notification.</h2>
        <div className="grid three">
          <article className="card">
            <h3>See who can talk</h3>
            <p>
              Browse creators, search, and sort by popularity or price. Follow people you want to reach
              again. You only start a call when their status says they are free.
            </p>
          </article>
          <article className="card">
            <h3>Know the price first</h3>
            <p>
              Audio and video rates are on the profile. Minutes come out of your spendable wallet only
              after the call is live. A low-balance warning arrives before the time runs out.
            </p>
          </article>
          <article className="card">
            <h3>Stay in control on the call</h3>
            <p>
              Mute, turn the camera off, send a gift, or hang up. Screenshots and screen recording are
              blocked on the call screen where the phone allows it. You confirm you are 18+ before the
              first call.
            </p>
          </article>
          <article className="card">
            <h3>A wallet that is only for spending</h3>
            <p>
              Recharges and referral bonuses sit in spendable balance. That balance pays for minutes and
              gifts. It is separate from any creator earnings, so the two never get mixed.
            </p>
          </article>
          <article className="card">
            <h3>After you hang up</h3>
            <p>
              Rate the call, report a problem, or block someone. History shows who you spoke with, how
              long, and the amount. You are not left managing a thread.
            </p>
          </article>
          <article className="card">
            <h3>Invite a friend</h3>
            <p>
              Share your code. When they complete a first recharge, you receive ₹25 spendable and they
              receive ₹20. Each bonus is paid once.
            </p>
          </article>
        </div>
      </section>

      <section className="section alt" id="earnings">
        <p className="kicker">For creators</p>
        <h2>Compare how attention turns into money.</h2>
        <p className="sub">
          These are product rules, not an income promise. What you earn depends on your rate, how long
          you stay available, and whether fans call.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th> </th>
                <th>DMs and comments</th>
                <th>Brand deals and ads</th>
                <th>Simple Talk</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>When you get paid</td>
                <td>Usually never</td>
                <td>After a campaign, often weeks later</td>
                <td>Per live minute, plus gifts during the call</td>
              </tr>
              <tr>
                <td>Who sets the price</td>
                <td>Nobody</td>
                <td>The brand, often through a middleman</td>
                <td>You, with separate audio and video rates</td>
              </tr>
              <tr>
                <td>Your share</td>
                <td>—</td>
                <td>Varies, and agencies take a cut</td>
                <td>About 85% after a 15% platform fee</td>
              </tr>
              <tr>
                <td>Your hours</td>
                <td>Always on, unpaid</td>
                <td>Fixed to someone else’s brief</td>
                <td>Available when you want. DND stops new calls</td>
              </tr>
              <tr>
                <td>Fan experience</td>
                <td>Wait for a reply</td>
                <td>They watch an ad</td>
                <td>They talk to you while you are free</td>
              </tr>
              <tr>
                <td>Payout</td>
                <td>—</td>
                <td>Invoice or platform delay</td>
                <td>Earnings wallet, withdraw to UPI from ₹100</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="grid three earn-grid">
          <article className="card">
            <p className="step">Example · audio</p>
            <h3>90 minutes at ₹8/min</h3>
            <p>The fan pays ₹720. You receive about ₹612. The platform keeps ₹108.</p>
          </article>
          <article className="card">
            <p className="step">Example · video</p>
            <h3>60 minutes at ₹18/min</h3>
            <p>The fan pays ₹1,080. You receive about ₹918. The platform keeps ₹162.</p>
          </article>
          <article className="card">
            <p className="step">Example · gifts</p>
            <h3>₹300 in gifts on a live call</h3>
            <p>The fan’s spendable balance drops by ₹300. You receive about ₹255, on top of the minutes.</p>
          </article>
        </div>
        <p className="note">
          Figures use the current 15% commission. A creator’s spendable balance and earnings balance are
          separate. Fans pay from spendable credit. You withdraw from earnings.
        </p>
      </section>

      <section className="section" id="services">
        <p className="kicker">What you can sell</p>
        <h2>The service is your time on a call.</h2>
        <p className="sub">
          Simple Talk does not have a shop, a course store, or a chat product. Monetising means being
          available for paid audio or video, and accepting gifts while you are live. People already use
          that shape of call for work like this.
        </p>
        <div className="grid three">
          {services.map((item) => (
            <article key={item.title} className="card">
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
        <p className="note">
          You stay responsible for what you offer. The app is for adults 18 and older. Illegal content,
          scams, and harassment can close the account and put pending earnings at risk.
        </p>
      </section>

      <section className="section alt">
        <p className="kicker">On the call</p>
        <h2>Privacy is part of the product, with a limit.</h2>
        <div className="grid two">
          <article className="card">
            <h3>What the app does</h3>
            <p>
              Screenshot and screen recording are blocked on the call screen where the operating system
              allows it. We do not store a recording of the call. Microphone and camera are used only
              during the session, after you grant permission.
            </p>
          </article>
          <article className="card">
            <h3>What it cannot stop</h3>
            <p>
              Another phone in the room can still record. Before the first call, both sides confirm they
              are 18 or older and that the other person may capture the conversation. Report or block
              from the review screen if something goes wrong.
            </p>
          </article>
        </div>
      </section>

      <section className="owner">
        <p className="kicker">Owner</p>
        <h2>Gandapodi V Saathvik</h2>
        <p>Simple Talk is owned by Gandapodi V Saathvik.</p>
        <p className="owner-links">
          <Link to="/privacy">Privacy policy</Link>
          <Link to="/terms">Terms and conditions</Link>
          <Link to="/delete-account">Delete account</Link>
        </p>
      </section>
    </main>
  );
}
