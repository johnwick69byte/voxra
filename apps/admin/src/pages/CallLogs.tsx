import { useEffect, useState } from "react";
import { adminAPI } from "../services/api";

export default function CallLogs() {
  const [calls, setCalls] = useState<any[]>([]);
  const [missed, setMissed] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const [l, m] = await Promise.all([adminAPI.callLogs(), adminAPI.missed()]);
      setCalls(l.data.calls || []);
      setMissed(m.data.calls || []);
    })();
  }, []);
  return (
    <div>
      <h1 className="page-title">Call logs</h1>
      <p className="page-sub">Recent calls and missed rings for monitoring quality.</p>
      <div className="panel">
        <h3>Missed ({missed.length})</h3>
        <table>
          <thead><tr><th>Call</th><th>Creator</th><th>Caller</th></tr></thead>
          <tbody>
            {missed.slice(0, 20).map((c) => (
              <tr key={c.call_id}><td>{c.call_id}</td><td>{c.receiver_id}</td><td>{c.caller_id}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h3>All recent</h3>
        <table>
          <thead><tr><th>Call</th><th>Status</th><th>Type</th><th>Amount</th><th>Duration</th></tr></thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.call_id}>
                <td>{c.call_id}</td>
                <td>{c.status}</td>
                <td>{c.call_type}</td>
                <td>₹{(c.total_amount || 0).toFixed(0)}</td>
                <td>{c.duration_seconds || 0}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
