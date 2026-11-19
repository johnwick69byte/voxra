import { useEffect, useState } from "react";
import { adminAPI } from "../services/api";
import { istDate } from "../utils/format";

const PAGE = 100;

export default function MissedCalls() {
  const [calls, setCalls] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);

  useEffect(() => {
    adminAPI
      .missed({ skip: page * PAGE, limit: PAGE })
      .then((r) => {
        setCalls(r.data.calls || []);
        setTotal(r.data.total ?? r.data.calls?.length ?? 0);
      })
      .catch(() => {});
  }, [page]);

  return (
    <div>
      <h1 className="page-title">Missed calls</h1>
      <p className="page-sub">
        {total || calls.length} calls that rang out. Times are Indian Standard Time.
      </p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>When (IST)</th>
              <th>Type</th>
              <th>Caller</th>
              <th>Creator</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.call_id}>
                <td>{istDate(c.created_at)}</td>
                <td>{c.call_type}</td>
                <td>
                  {c.caller_name || c.caller_id}
                  {c.caller_name && (
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{c.caller_id}</div>
                  )}
                </td>
                <td>
                  {c.receiver_name || c.receiver_id}
                  {c.receiver_name && (
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{c.receiver_id}</div>
                  )}
                </td>
              </tr>
            ))}
            {!calls.length && (
              <tr><td colSpan={4} style={{ color: "var(--muted)" }}>No missed calls</td></tr>
            )}
          </tbody>
        </table>
        {total > PAGE && (
          <div className="row" style={{ marginTop: 16, alignItems: "center" }}>
            <button className="btn ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <span style={{ color: "var(--muted)" }}>
              Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE))}
            </span>
            <button
              className="btn ghost"
              disabled={(page + 1) * PAGE >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
