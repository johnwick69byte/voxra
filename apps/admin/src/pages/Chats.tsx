import { useEffect, useState } from "react";
import { adminAPI } from "../services/api";
import { istDate } from "../utils/format";

function inr(n: number | undefined) {
  return `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function when(value?: string) {
  return istDate(value);
}

export default function Chats() {
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [thread, setThread] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.chats({ limit: 100 });
      setRows(res.data.conversations || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) {
      setThread(null);
      return;
    }
    adminAPI
      .chatThread(selected)
      .then((res) => setThread(res.data))
      .catch(() => setThread(null));
  }, [selected]);

  const conversation = thread?.conversation;

  return (
    <div>
      <h1 className="page-title">Chats</h1>
      <p className="page-sub">
        Fan messages are ₹1 each. Half is creator earnings and half is platform revenue. Creator replies are free.
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Fan</th>
              <th>Creator</th>
              <th>Messages</th>
              <th>Fan spend</th>
              <th>Creator</th>
              <th>Platform</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.conversation_id}>
                <td>{when(row.last_message_at)}</td>
                <td>{row.fan_name}</td>
                <td>{row.creator_name}</td>
                <td>{row.message_count}</td>
                <td>{inr(row.fan_spend)}</td>
                <td>{inr(row.creator_earnings)}</td>
                <td>{inr(row.platform_share)}</td>
                <td>
                  <button className="btn ghost" onClick={() => setSelected(row.conversation_id)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !rows.length ? <p style={{ color: "var(--muted)" }}>No chats yet</p> : null}
      </div>

      {conversation ? (
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>
              {conversation.fan_name} → {conversation.creator_name}
            </h3>
            <button className="btn ghost" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          <p style={{ color: "var(--muted)" }}>
            {conversation.message_count} messages · fan {inr(conversation.fan_spend)} · creator{" "}
            {inr(conversation.creator_earnings)} · platform {inr(conversation.platform_share)}
          </p>
          {(thread.messages || []).map((message: any) => (
            <div
              key={message.message_id}
              style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <strong>
                  {message.sender_id === conversation.fan_id ? conversation.fan_name : conversation.creator_name}
                </strong>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  {when(message.created_at)}
                  {message.paid ? ` · paid ${inr(message.price)}` : " · free"}
                </span>
              </div>
              <p style={{ margin: "6px 0 0" }}>{message.text}</p>
            </div>
          ))}
          {!thread.messages?.length ? <p style={{ color: "var(--muted)" }}>No messages in this thread</p> : null}
        </div>
      ) : null}
    </div>
  );
}
