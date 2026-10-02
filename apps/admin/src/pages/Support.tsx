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
  useEffect(() => {
    load();
  }, []);

  const openCount = items.filter((m) => m.status === "open").length;

  return (
    <div>
      <h1 className="page-title">Support inbox</h1>
      <p className="page-sub">{openCount} open · {items.length} total.</p>
      <div className="panel">
        {items.map((m) => (
          <div key={m.message_id} style={{ borderBottom: "1px solid var(--border)", padding: "14px 0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <strong>{m.subject}</strong>
              <span className={`badge ${m.status === "replied" ? "" : "warn"}`}>{m.status}</span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
              {m.user_name || m.user_id}
              {m.user_phone ? ` · ${m.user_phone}` : ""}
              {m.created_at ? ` · ${new Date(m.created_at).toLocaleString()}` : ""}
            </div>
            <p>{m.message}</p>
            {m.reply && <p style={{ color: "var(--brand)" }}>Reply: {m.reply}</p>}
            <div className="row">
              <input
                style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}
                placeholder="Reply…"
                value={reply[m.message_id] || ""}
                onChange={(e) => setReply({ ...reply, [m.message_id]: e.target.value })}
              />
              {m.status === "open" && (
                <button
                  className="btn ghost"
                  onClick={async () => {
                    await adminAPI.markSupportRead(m.message_id);
                    load();
                  }}
                >
                  Mark read
                </button>
              )}
              <button
                className="btn"
                onClick={async () => {
                  await adminAPI.replySupport(m.message_id, reply[m.message_id] || "");
                  toast.success("Replied");
                  setReply({ ...reply, [m.message_id]: "" });
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
