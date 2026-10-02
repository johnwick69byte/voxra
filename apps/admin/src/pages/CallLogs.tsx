import { useEffect, useState } from "react";
import { adminAPI } from "../services/api";

function inr(n: number | undefined) {
  return `₹${Number(n || 0).toFixed(2)}`;
}

export default function CallLogs() {
  const [calls, setCalls] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});

  useEffect(() => {
    adminAPI
      .callLogs()
      .then((r) => {
        setCalls(r.data.calls || []);
        setSummary(r.data.summary || {});
      })
      .catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="page-title">Call logs</h1>
      <p className="page-sub">Completed call history and financial performance.</p>

      <div className="grid">
        <div className="metric">
          <div className="label">Total revenue</div>
          <div className="value">{inr(summary.total_revenue)}</div>
        </div>
        <div className="metric">
          <div className="label">Creator earnings</div>
          <div className="value">{inr(summary.total_model_earnings)}</div>
        </div>
        <div className="metric">
          <div className="label">Platform commission</div>
          <div className="value">{inr(summary.total_platform_commission)}</div>
        </div>
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Creator</th>
              <th>Caller</th>
              <th>Type</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Total</th>
              <th>Earnings</th>
              <th>Commission</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.call_id}>
                <td>{c.created_at ? new Date(c.created_at).toLocaleString() : "—"}</td>
                <td>{c.receiver_name || c.receiver_id}</td>
                <td>{c.caller_name || c.caller_id}</td>
                <td><span className="badge">{c.call_type}</span></td>
                <td>{Math.floor((c.duration_seconds || 0) / 60)}m {(c.duration_seconds || 0) % 60}s</td>
                <td>{c.status}</td>
                <td>{inr(c.total_amount)}</td>
                <td>{inr(c.model_earnings)}</td>
                <td>{inr(c.commission)}</td>
              </tr>
            ))}
            {!calls.length && (
              <tr><td colSpan={9} style={{ color: "var(--muted)" }}>No calls yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
