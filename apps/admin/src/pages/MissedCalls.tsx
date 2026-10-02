import { useEffect, useState } from "react";
import { adminAPI } from "../services/api";

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
              <th>Call</th>
              <th>Type</th>
              <th>Caller</th>
              <th>Creator</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.call_id}>
                <td>{c.call_id}</td>
                <td>{c.call_type}</td>
                <td>{c.caller_id}</td>
                <td>{c.receiver_id}</td>
                <td>{c.created_at ? new Date(c.created_at).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {!calls.length && (
              <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No missed calls</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
