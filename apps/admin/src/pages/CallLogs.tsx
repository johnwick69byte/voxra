import { useEffect, useState } from "react";
import { adminAPI } from "../services/api";
import { istDate } from "../utils/format";

function inr(n: number | undefined) {
  return `₹${Number(n || 0).toFixed(2)}`;
}

const PAGE = 100;

export default function CallLogs() {
  const [calls, setCalls] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    adminAPI
      .callLogs({ skip: page * PAGE, limit: PAGE })
      .then((r) => {
        setCalls(r.data.calls || []);
        setSummary(r.data.summary || {});
        setTotal(r.data.total || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page]);

  const from = total === 0 ? 0 : page * PAGE + 1;
  const to = Math.min(total, page * PAGE + calls.length);
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div>
      <h1 className="page-title">Call logs</h1>
      <p className="page-sub">
        All call records, newest first. Times are Indian Standard Time.
        {total > 0 ? ` Showing ${from}–${to} of ${total}.` : ""}
      </p>

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
              <th>When (IST)</th>
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
                <td>{istDate(c.created_at)}</td>
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
            {!loading && !calls.length && (
              <tr><td colSpan={9} style={{ color: "var(--muted)" }}>No calls yet</td></tr>
            )}
          </tbody>
        </table>
        {total > PAGE && (
          <div className="row" style={{ marginTop: 16, alignItems: "center" }}>
            <button className="btn ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span style={{ color: "var(--muted)" }}>Page {page + 1} of {pages}</span>
            <button className="btn ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
