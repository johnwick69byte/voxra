import { useEffect, useState } from "react";
import { adminAPI } from "../services/api";
import { istDate } from "../utils/format";

export default function MissedCalls() {
  const [calls, setCalls] = useState<any[]>([]);

  useEffect(() => {
    adminAPI.missed().then((r) => setCalls(r.data.calls || [])).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="page-title">Missed calls</h1>
      <p className="page-sub">{calls.length} calls that rang out.</p>
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
      </div>
    </div>
  );
}
