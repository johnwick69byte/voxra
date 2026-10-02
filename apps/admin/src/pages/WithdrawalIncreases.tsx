import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { adminAPI } from "../services/api";

export default function WithdrawalIncreases() {
  const [items, setItems] = useState<any[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const res = await adminAPI.increaseRequests();
    setItems(res.data.requests || []);
  };
  useEffect(() => {
    load();
  }, []);

  const approve = async (id: string) => {
    const val = Number(amounts[id]);
    if (!val || val <= 25000) {
      toast.error("Approved amount must be greater than ₹25000");
      return;
    }
    setBusy(id);
    try {
      await adminAPI.approveIncrease(id, val);
      toast.success("Approved");
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally {
      setBusy(null);
    }
  };

  const reject = async (id: string) => {
    setBusy(id);
    try {
      await adminAPI.rejectIncrease(id);
      toast.success("Rejected");
      load();
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Failed");
    } finally {
      setBusy(null);
    }
  };

  const pending = items.filter((r) => r.status === "PENDING");

  return (
    <div>
      <h1 className="page-title">Withdrawal limit requests</h1>
      <p className="page-sub">
        {pending.length} pending · {items.length} total. Approving raises that creator's maximum
        withdrawal amount.
      </p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Requested max</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Approve amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.request_id}>
                <td>
                  {r.user_id}
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}
                  </div>
                </td>
                <td>₹{Number(r.requested_max_amount).toLocaleString()}</td>
                <td>{r.reason || <em style={{ color: "var(--muted)" }}>No reason</em>}</td>
                <td>
                  <span className={`badge ${r.status === "PENDING" ? "warn" : r.status === "REJECTED" ? "danger" : ""}`}>
                    {r.status}
                  </span>
                </td>
                <td>
                  {r.status === "PENDING" ? (
                    <input
                      type="number"
                      placeholder="> 25000"
                      value={amounts[r.request_id] || ""}
                      onChange={(e) => setAmounts((p) => ({ ...p, [r.request_id]: e.target.value }))}
                      style={{ width: 120, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border)" }}
                    />
                  ) : (
                    r.approved_max_amount ? `₹${Number(r.approved_max_amount).toLocaleString()}` : "—"
                  )}
                </td>
                <td className="row">
                  {r.status === "PENDING" && (
                    <>
                      <button className="btn ok" disabled={busy === r.request_id} onClick={() => approve(r.request_id)}>
                        Approve
                      </button>
                      <button className="btn danger" disabled={busy === r.request_id} onClick={() => reject(r.request_id)}>
                        Reject
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No requests</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
