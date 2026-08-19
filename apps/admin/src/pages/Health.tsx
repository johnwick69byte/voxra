import { useEffect, useState } from "react";
import { adminAPI } from "../services/api";

export default function Health() {
  const [health, setHealth] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const load = async () => {
    const [h, a] = await Promise.all([adminAPI.health(), adminAPI.audit()]);
    setHealth(h.data);
    setAudit(a.data.audit || []);
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  return (
    <div>
      <h1 className="page-title">System health</h1>
      <p className="page-sub">Redis, sockets, stuck-call sweeper, admin audit trail.</p>
      <div className="grid">
        <div className="metric">
          <div className="label">Redis</div>
          <div className="value">{health?.redis_ok ? "OK" : "DOWN"}</div>
        </div>
        <div className="metric">
          <div className="label">Socket connections</div>
          <div className="value">{health?.socket_connections ?? "—"}</div>
        </div>
        <div className="metric">
          <div className="label">Swept stuck</div>
          <div className="value">{health?.stuck_calls_swept ?? 0}</div>
        </div>
      </div>
      <div className="panel">
        <h3>Admin audit</h3>
        <table>
          <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Meta</th></tr></thead>
          <tbody>
            {audit.map((a, i) => (
              <tr key={i}>
                <td>{a.created_at}</td>
                <td>{a.admin_id}</td>
                <td>{a.action}</td>
                <td><code>{JSON.stringify(a.meta)}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
