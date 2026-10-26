import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { adminAPI } from "../services/api";

const TABS = ["pending", "processed", "failed"] as const;
type Tab = (typeof TABS)[number];

function inr(n: any) {
  return `₹${Number(n || 0).toFixed(2)}`;
}

function referralCell(w: any) {
  if (w.status === "REJECTED") {
    return <span style={{ color: "var(--muted)" }}>Refunded — no fee</span>;
  }
  if (w.referral_status === "LEGACY") {
    return <span style={{ color: "var(--muted)" }}>Legacy payout — no fee recorded</span>;
  }
  if (w.referral_status === "REFUNDED") {
    return <span style={{ color: "var(--muted)" }}>Refunded — no fee</span>;
  }
  if (w.referral_status === "RETRY_PENDING") {
    return (
      <>
        <div>
          {inr(w.potential_referral_bonus_amount || w.referral_bonus_amount)} →{" "}
          {w.referrer_name || w.referrer_id} (retry pending)
        </div>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>
          Platform keeps {inr(w.platform_commission_amount)} until the bonus is paid
        </div>
      </>
    );
  }
  if (w.referrer_id && w.referral_status !== "CANCELLED") {
    return (
      <>
        <div>
          {inr(w.referral_bonus_amount)} → {w.referrer_name || w.referrer_id}
          {w.referral_status === "PAID" ? " (paid)" : ""}
        </div>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>
          Platform keeps {inr(w.platform_commission_amount)}
        </div>
      </>
    );
  }
  if (w.referral_status === "CANCELLED") {
    return (
      <>
        <div>Platform keeps {inr(w.commission_amount)}</div>
        <div style={{ color: "var(--muted)", fontSize: 12 }}>
          Referral cancelled — account deleted or unavailable
        </div>
      </>
    );
  }
  return (
    <>
      <div>Platform keeps {inr(w.commission_amount)}</div>
      <div style={{ color: "var(--muted)", fontSize: 12 }}>No active referral</div>
    </>
  );
}

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
      const res = await adminAPI.markPaid(id);
      toast.success(`Paid ${inr(res.data.payout_amount)} to the creator`);
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

  const retryBonus = async (id: string) => {
    setBusy(id);
    try {
      const res = await adminAPI.markPaid(id);
      toast.success(
        res.data.referral_bonus_paid
          ? `Referral bonus paid: ${inr(res.data.referral_bonus_amount)}`
          : `No bonus paid (${res.data.referral_status || "not applicable"})`
      );
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
      <p className="page-sub">
        Creators pay a 10% withdrawal commission. If the creator was referred, 5% goes
        to the referrer and 5% to the platform; otherwise the platform keeps all 10%.
        Send the creator the payout amount, not the requested amount.
      </p>
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
              <th>Requested</th>
              <th>Payout</th>
              <th>Fee (10%)</th>
              <th>Referral (5%) / platform</th>
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
                <td>{inr(w.amount)}</td>
                <td>
                  {w.status === "REJECTED" ? "—" : inr(w.payout_amount)}
                </td>
                <td>
                  {w.status === "REJECTED" ? "—" : inr(w.commission_amount)}
                </td>
                <td>{referralCell(w)}</td>
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
                    <>
                      <button className="btn ghost" disabled={busy === w.request_id} onClick={() => retryBonus(w.request_id)}>
                        Retry bonus
                      </button>
                      <button className="btn danger" disabled={busy === w.request_id} onClick={() => markError(w.request_id)}>
                        Mark failed
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr><td colSpan={9} style={{ color: "var(--muted)" }}>Nothing here</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
