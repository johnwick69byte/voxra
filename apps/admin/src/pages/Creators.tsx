import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { adminAPI } from "../services/api";

export default function Creators() {
  const [items, setItems] = useState<any[]>([]);
  const load = async () => {
    const res = await adminAPI.pendingCreators();
    setItems(res.data.creators || []);
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <h1 className="page-title">Creator verification</h1>
      <p className="page-sub">Approve creators after rates & profile are submitted.</p>
      <div className="panel">
        <table>
          <thead>
            <tr><th>Name</th><th>User</th><th>Audio</th><th>Video</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.user_id}>
                <td>{c.user?.name || "—"}</td>
                <td>{c.user_id}</td>
                <td>₹{c.audio_rate_per_minute}</td>
                <td>₹{c.video_rate_per_minute}</td>
                <td><span className="badge warn">{c.verification_status}</span></td>
                <td className="row">
                  <button className="btn ok" onClick={async () => { await adminAPI.approve(c.user_id); toast.success("Approved"); load(); }}>Approve</button>
                  <button className="btn danger" onClick={async () => { await adminAPI.reject(c.user_id); toast.success("Rejected"); load(); }}>Reject</button>
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} style={{ color: "var(--muted)" }}>Queue empty</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
