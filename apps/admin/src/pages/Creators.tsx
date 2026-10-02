import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { adminAPI } from "../services/api";

export default function Creators() {
  const [tab, setTab] = useState<"pending" | "verified">("pending");
  const [items, setItems] = useState<any[]>([]);

  const load = async (which: "pending" | "verified" = tab) => {
    const res = which === "pending" ? await adminAPI.pendingCreators() : await adminAPI.verifiedCreators();
    setItems(res.data.creators || []);
  };

  useEffect(() => {
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div>
      <h1 className="page-title">Creator verification</h1>
      <p className="page-sub">Approve creators after rates & profile are submitted.</p>
      <div className="row" style={{ marginBottom: 16 }}>
        <button className={tab === "pending" ? "btn" : "btn ghost"} onClick={() => setTab("pending")}>
          Pending
        </button>
        <button className={tab === "verified" ? "btn" : "btn ghost"} onClick={() => setTab("verified")}>
          Verified
        </button>
      </div>
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
                  {tab === "pending" ? (
                    <>
                      <button className="btn ok" onClick={async () => { await adminAPI.approve(c.user_id); toast.success("Approved"); load(); }}>Approve</button>
                      <button className="btn danger" onClick={async () => { await adminAPI.reject(c.user_id); toast.success("Rejected"); load(); }}>Reject</button>
                    </>
                  ) : (
                    <button className="btn danger" onClick={async () => { await adminAPI.suspend(c.user_id); toast.success("Suspended"); }}>Suspend</button>
                  )}
                </td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={9} style={{ color: "var(--muted)" }}>Nothing here</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
