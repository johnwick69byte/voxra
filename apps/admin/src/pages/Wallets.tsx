import { useState } from "react";
import toast from "react-hot-toast";
import { adminAPI } from "../services/api";

export default function Wallets() {
  const [phone, setPhone] = useState("");
  const [user, setUser] = useState<any>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState("");

  const search = async () => {
    try {
      const r = await adminAPI.walletSearch(phone);
      setUser(r.data.user);
      setBalance(r.data.balance);
    } catch {
      toast.error("User not found");
      setUser(null);
      setBalance(null);
    }
  };

  const credit = async () => {
    try {
      const r = await adminAPI.walletCredit(phone, Number(amount));
      setBalance(r.data.balance);
      toast.success(`Credited ${r.data.credit}, commission ${r.data.commission}`);
    } catch {
      toast.error("Credit failed");
    }
  };

  return (
    <div>
      <h1 className="page-title">Wallets</h1>
      <div className="panel" style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="91XXXXXXXXXX" />
        <button className="btn" onClick={search}>Search</button>
      </div>
      {user && (
        <div className="panel">
          <p>{user.name || user.user_id}</p>
          <p>Balance: {balance}</p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" />
            <button className="btn" onClick={credit}>Credit</button>
          </div>
        </div>
      )}
    </div>
  );
}
