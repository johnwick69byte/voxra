import { useEffect, useState } from "react";
import { adminAPI } from "../services/api";

export default function Audit() {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    adminAPI.audit().then((r) => setItems(r.data.audit || [])).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="page-title">Audit log</h1>
      <p className="page-sub">Admin actions, newest first.</p>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Admin</th>
              <th>Action</th>
              <th>Detail</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a, i) => (
              <tr key={i}>
                <td>{a.admin_id}</td>
                <td><span className="badge">{a.action}</span></td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>
                  {a.meta ? JSON.stringify(a.meta) : "—"}
                </td>
                <td>{a.created_at ? new Date(a.created_at).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {!items.length && (
              <tr><td colSpan={4} style={{ color: "var(--muted)" }}>No audit entries</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
