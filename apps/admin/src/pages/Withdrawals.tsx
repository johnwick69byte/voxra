import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { adminAPI } from "../services/api";

const TABS = ["pending", "processed", "failed"] as const;
type Tab = (typeof TABS)[number];

export default function Withdrawals() {
  const [tab, setTab] = useState<Tab>("pending");
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (which: Tab = tab) => {
    const res =
      which === "pending"
        ? await adminAPI.withdrawals()
        : which === "processed"
        ? await adminAPI.processedWithdrawals()
        : await adminAPI.failedWithdrawals();
    setItems(res.data.withdrawals || []);
  };

  useEffect(() => {
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const markPaid = async (id: string) => {
    setBusy(id);
    try {
      await adminAPI.markPaid(id);
      toast.success("Marked paid");
      load();
    } finally {
      setBusy(null);
    }
  };

  const reject = async (id: string) => {
    setBusy(id);
    try {
      await adminAPI.rejectWd(id);
      toast.success("Rejected & refunded");
      load();
    } finally {
      setBusy(null);
    }
  };

  const markError = async (id: string) => {
    const remarks = window.prompt("Payment error remarks?");
    if (remarks === null) return;
    setBusy(id);
    try {
      await adminAPI.markError(id, remarks, true);
      toast.success("Marked failed & refunded");
      load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h1 className="page-title">Withdrawals</h1>
      <p className="page-sub">Mark paid after UPI transfer, or reject to refund earnings.</p>
      <div className="row" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "btn" : "btn ghost"} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>User</th>
              <th>Amount</th>
              <th>UPI</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.request_id}>
                <td>{w.request_id}</td>
                <td>{w.user_id}</td>
                <td>₹{w.amount}</td>
                <td>{w.upi_id}</td>
                <td><span className="badge warn">{w.status}</span></td>
                <td className="row">
                  {tab === "pending" && (
                    <>
                      <button className="btn ok" disabled={busy === w.request_id} onClick={() => markPaid(w.request_id)}>
                        Mark paid
                      </button>
                      <button className="btn danger" disabled={busy === w.request_id} onClick={() => reject(w.request_id)}>
                        Reject
                      </button>
                    </>
                  )}
                  {tab === "processed" && (
                    <button className="btn danger" disabled={busy === w.request_id} onClick={() => markError(w.request_id)}>
                      Mark failed
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr><td colSpan={6} style={{ color: "var(--muted)" }}>Nothing here</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
