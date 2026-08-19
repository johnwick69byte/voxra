import { useState } from "react";
import toast from "react-hot-toast";
import { adminAPI } from "../services/api";

export default function Broadcast() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("all");
  return (
    <div>
      <h1 className="page-title">Broadcast</h1>
      <p className="page-sub">Push + in-app update notifications (force-update via app config min version).</p>
      <div className="panel" style={{ maxWidth: 560 }}>
        <div className="field">
          <label>Audience</label>
          <select value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="all">All</option>
            <option value="users">Fans</option>
            <option value="creators">Creators</option>
          </select>
        </div>
        <div className="field">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>Body</label>
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <button
          className="btn"
          style={{ marginTop: 16 }}
          onClick={async () => {
            const res = await adminAPI.broadcast(title, body, audience);
            toast.success(`Queued / sent ${res.data.sent}`);
          }}
        >
          Send broadcast
        </button>
      </div>
    </div>
  );
}
