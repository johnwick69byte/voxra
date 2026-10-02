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
            <tr><th>Photos</th><th>Selfie</th><th>Fingers</th><th>Name</th><th>Phone</th><th>Audio</th><th>Video</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.user_id}>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    {(c.images || []).slice(0, 4).map((url: string) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer">
                        <img src={url} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />
                      </a>
                    ))}
                    {!(c.images || []).length && "—"}
                  </div>
                </td>
                <td>
                  {c.verification_selfie_url ? (
                    <a href={c.verification_selfie_url} target="_blank" rel="noreferrer">
                      <img src={c.verification_selfie_url} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8 }} />
                    </a>
                  ) : "—"}
                </td>
                <td>{c.gesture_number ?? "—"}</td>
                <td>{c.user?.name || "—"}</td>
                <td>{c.user?.phone || "—"}</td>
                <td>₹{c.audio_rate_per_minute}</td>
                <td>₹{c.video_rate_per_minute}</td>
                <td><span className="badge warn">{c.verification_status}</span></td>
                <td className="row">
                  <button className="btn ok" onClick={async () => { await adminAPI.approve(c.user_id); toast.success("Approved"); load(); }}>Approve</button>
                  <button className="btn danger" onClick={async () => { await adminAPI.reject(c.user_id); toast.success("Rejected"); load(); }}>Reject</button>
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={9} style={{ color: "var(--muted)" }}>Queue empty</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
