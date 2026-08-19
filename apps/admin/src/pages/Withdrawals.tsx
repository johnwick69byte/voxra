import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { adminAPI } from "../services/api";

export default function Withdrawals() {
  const [items, setItems] = useState<any[]>([]);
  const load = async () => {
    const res = await adminAPI.withdrawals();
    setItems(res.data.withdrawals || []);
  };
  useEffect(() => { load(); }, []);
  return (
    <div>
      <h1 className="page-title">Withdrawals</h1>
      <p className="page-sub">Mark paid after UPI transfer, or reject to refund earnings.</p>
      <div className="panel">
        <table>
          <thead><tr><th>Request</th><th>User</th><th>Amount</th><th>UPI</th><th></th></tr></thead>
          <tbody>
            {items.map((w) => (
              <tr key={w.request_id}>
                <td>{w.request_id}</td>
                <td>{w.user_id}</td>
                <td>₹{w.amount}</td>
                <td>{w.upi_id}</td>
                <td className="row">
                  <button className="btn ok" onClick={async () => { await adminAPI.markPaid(w.request_id); toast.success("Marked paid"); load(); }}>Mark paid</button>
                  <button className="btn danger" onClick={async () => { await adminAPI.rejectWd(w.request_id); toast.success("Rejected & refunded"); load(); }}>Reject</button>
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No pending withdrawals</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
