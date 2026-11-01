import { useEffect, useState } from "react";
import { adminAPI } from "../services/api";

export default function Health() {
  const [health, setHealth] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [h, a] = await Promise.all([adminAPI.health(), adminAPI.audit()]);
      setHealth(h.data);
      setAudit(a.data.audit || []);
      setError(null);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Failed to load health data");
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const ok = (v: boolean | undefined) =>
    v ? <span style={{ color: "var(--success, #22c55e)" }}>✓ OK</span>
      : <span style={{ color: "var(--danger, #ef4444)" }}>✗ DOWN</span>;

  return (
    <div>
      <h1 className="page-title">System health</h1>
      <p className="page-sub">
        Redis, sockets, stuck-call sweeper, Firebase, admin audit trail.{" "}
        {health?.ts && (
          <span style={{ opacity: 0.5, fontSize: 12 }}>
            Last updated {new Date(health.ts).toLocaleTimeString()}
          </span>
        )}
      </p>

      {error && (
        <div className="panel" style={{ color: "var(--danger, #ef4444)", marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      {!health && !error && (
        <div className="panel" style={{ opacity: 0.5 }}>Loading…</div>
      )}

      {health && (
        <>
          <div className="grid" style={{ marginBottom: 16 }}>
            <div className="metric">
              <div className="label">Redis</div>
              <div className="value">{ok(health.redis_ok)}</div>
            </div>
            <div className="metric">
              <div className="label">Socket connections</div>
              <div className="value">{health.socket_connections ?? "—"}</div>
            </div>
            <div className="metric">
              <div className="label">Stuck calls swept</div>
              <div className="value">{health.stuck_calls_swept ?? 0}</div>
            </div>
            <div className="metric">
              <div className="label">Firebase FCM</div>
              <div className="value">{ok(health.firebase?.ready)}</div>
              {health.firebase?.project_id && (
                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
                  {health.firebase.project_id}
                </div>
              )}
              {health.firebase?.error && (
                <div style={{ fontSize: 11, color: "var(--danger, #ef4444)", marginTop: 4 }}>
                  {health.firebase.error}
                </div>
              )}
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Firebase details</h3>
            <table>
              <tbody>
                <tr><td style={{ opacity: 0.6, paddingRight: 16 }}>Configured</td><td>{health.firebase?.configured ? "Yes" : "No"}</td></tr>
                <tr><td style={{ opacity: 0.6, paddingRight: 16 }}>Source</td><td>{health.firebase?.source ?? "—"}</td></tr>
                <tr><td style={{ opacity: 0.6, paddingRight: 16 }}>Ready</td><td>{health.firebase?.ready ? "Yes" : "No"}</td></tr>
                <tr><td style={{ opacity: 0.6, paddingRight: 16 }}>Project ID</td><td>{health.firebase?.project_id ?? "—"}</td></tr>
                {health.firebase?.error && (
                  <tr><td style={{ opacity: 0.6, paddingRight: 16 }}>Error</td><td style={{ color: "var(--danger, #ef4444)" }}>{health.firebase.error}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Admin audit trail</h3>
        {audit.length === 0 ? (
          <p style={{ opacity: 0.5 }}>No audit entries yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Meta</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {a.created_at ? new Date(a.created_at).toLocaleString() : "—"}
                  </td>
                  <td>{a.admin_id}</td>
                  <td>{a.action}</td>
                  <td><code style={{ fontSize: 11 }}>{JSON.stringify(a.meta)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
