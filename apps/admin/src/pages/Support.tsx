import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { adminAPI } from "../services/api";

export default function Support() {
  const [items, setItems] = useState<any[]>([]);
  const [reply, setReply] = useState<Record<string, string>>({});
  const load = async () => {
    const res = await adminAPI.support();
    setItems(res.data.messages || []);
  };
  useEffect(() => { load(); }, []);
  return (
    <div>
      <h1 className="page-title">Support inbox</h1>
      <div className="panel">
        {items.map((m) => (
          <div key={m.message_id} style={{ borderBottom: "1px solid var(--border)", padding: "14px 0" }}>
            <strong>{m.subject}</strong>
            <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>{m.user_id} · {m.status}</div>
            <p>{m.message}</p>
            {m.reply && <p style={{ color: "var(--brand)" }}>Reply: {m.reply}</p>}
            <div className="row">
              <input
                style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}
                placeholder="Reply…"
                value={reply[m.message_id] || ""}
                onChange={(e) => setReply({ ...reply, [m.message_id]: e.target.value })}
              />
              <button
                className="btn"
                onClick={async () => {
                  await adminAPI.replySupport(m.message_id, reply[m.message_id] || "");
                  toast.success("Replied");
                  load();
                }}
              >
                Send
              </button>
            </div>
          </div>
        ))}
        {!items.length && <p style={{ color: "var(--muted)" }}>No messages</p>}
      </div>
    </div>
  );
}
