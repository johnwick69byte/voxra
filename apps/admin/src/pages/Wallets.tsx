import { useState } from "react";
import toast from "react-hot-toast";
import { adminAPI } from "../services/api";

export default function Wallets() {
  const [phone, setPhone] = useState("");
  const [user, setUser] = useState<any>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [earnings, setEarnings] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [searching, setSearching] = useState(false);
  const [crediting, setCrediting] = useState(false);

  const search = async () => {
    if (!phone.trim()) return;
    setSearching(true);
    setUser(null);
    setBalance(null);
    try {
      const r = await adminAPI.walletSearch(phone.trim());
      setUser(r.data.user);
      setBalance(r.data.balance ?? 0);
      setEarnings(r.data.earnings_balance ?? 0);
    } catch (e: any) {
      const msg = e?.response?.data?.detail || "User not found";
      toast.error(msg);
      setUser(null);
      setBalance(null);
    } finally {
      setSearching(false);
    }
  };

  const credit = async () => {
    const n = Number(amount);
    if (!n || n <= 0) { toast.error("Enter a valid amount"); return; }
    setCrediting(true);
    try {
      const r = await adminAPI.walletCredit(phone.trim(), n);
      setBalance(r.data.balance);
      setAmount("");
      toast.success(`✓ Credited ₹${r.data.credit?.toFixed(2)} to user (₹${r.data.commission?.toFixed(2)} commission recorded)`);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Credit failed");
    } finally {
      setCrediting(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">Wallets</h1>
      <p className="page-sub">Search by phone number (10-digit, or with 91 country code).</p>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="e.g. 9492045797 or 919492045797"
            style={{ flex: 1 }}
          />
          <button className="btn" onClick={search} disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
      </div>

      {user && (
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 18 }}>{user.name || "—"}</div>
              <div style={{ opacity: 0.6, fontSize: 13, marginTop: 2 }}>
                @{user.username || "—"} · {user.phone} · {user.user_type}
              </div>
              <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>{user.user_id}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, opacity: 0.6 }}>Spendable balance</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--brand, #2dd4bf)" }}>
                ₹{(balance ?? 0).toFixed(2)}
              </div>
              {earnings != null && earnings > 0 && (
                <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>
                  Earnings: ₹{earnings.toFixed(2)}
                </div>
              )}
            </div>
          </div>

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 10 }}>Manual credit (recharge)</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && credit()}
                placeholder="Gross amount (e.g. 100)"
                style={{ flex: 1 }}
                min={1}
              />
              <button className="btn" onClick={credit} disabled={crediting}>
                {crediting ? "Crediting…" : "Credit"}
              </button>
            </div>
            <p style={{ fontSize: 12, opacity: 0.5, marginTop: 6 }}>
              Same economics as a normal recharge — 6% commission retained, 94% credited to user.
              Commission is recorded in platform_commissions.
              {amount && Number(amount) > 0
                ? ` ₹${Number(amount).toFixed(2)} gross → ₹${(Number(amount) * 0.94).toFixed(2)} to user, ₹${(Number(amount) * 0.06).toFixed(2)} commission.`
                : ""}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
