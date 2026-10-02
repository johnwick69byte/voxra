import { Link, NavLink } from "react-router-dom";
import type { ReactNode } from "react";

export function SiteChrome({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="nav">
        <Link to="/" className="brand">
          Simple Talk
        </Link>
        <nav className="nav-links">
          <a href="/#how">How it works</a>
          <a href="/#fans">For fans</a>
          <a href="/#earnings">Earnings</a>
          <a href="/#services">Services</a>
          <NavLink to="/privacy">Privacy</NavLink>
          <NavLink to="/terms">Terms</NavLink>
        </nav>
      </header>
      {children}
      <footer className="footer">
        <div>
          <strong>Simple Talk</strong>
          <p>Instant audio and video between fans and creators.</p>
        </div>
        <div className="footer-links">
          <Link to="/privacy">Privacy policy</Link>
          <Link to="/terms">Terms and conditions</Link>
        </div>
      </footer>
    </>
  );
}
