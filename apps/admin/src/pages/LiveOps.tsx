import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { adminAPI } from "../services/api";

type LiveOpsMetrics = {
  active_calls_count: number;
  miss_rate_today: number;
  calls_today: number;
  missed_today: number;
  fcm_fail_count: number;
  fcm_ok_count: number;
};

type StuckCreator = {
  user_id: string;
  name?: string;
  username?: string;
  status: string;
};

export default function LiveOps() {
  const [calls, setCalls] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<LiveOpsMetrics | null>(null);
  const [stuckBusy, setStuckBusy] = useState<StuckCreator[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  const load = async (showSpinner = false) => {
    if (showSpinner) {
      setRefreshing(true);
      refreshingRef.current = true;
    }
    try {
      const res = await adminAPI.liveOps();
      setCalls(res.data.calls || []);
      setMetrics(res.data.metrics || null);
      setStuckBusy(res.data.stuck_busy_creators || []);
    } finally {
      if (showSpinner) {
        setRefreshing(false);
        refreshingRef.current = false;
      }
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Live ops</h1>
        <button
          className="btn ghost"
          onClick={() => load(true)}
          disabled={refreshing}
          style={{ display: "flex", alignItems: "center", gap: 6 }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              animation: refreshing ? "liveops-spin 0.7s linear infinite" : "none",
            }}
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p className="page-sub">
        Active & ringing calls — auto-refresh every 30s. Force-end clears stuck calls; force-offline
        clears stuck BUSY creators.
      </p>
      <style>{`
        @keyframes liveops-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      {metrics && (
        <div className="panel" style={{ marginBottom: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Active calls</div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{metrics.active_calls_count}</div>
          </div>
          <div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Miss rate today</div>
            <div style={{ fontSize: 24, fontWeight: 600 }}>{metrics.miss_rate_today}%</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              {metrics.missed_today} / {metrics.calls_today} calls
            </div>
          </div>
          <div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>FCM OK</div>
            <div style={{ fontSize: 24, fontWeight: 600, color: "var(--success, #22c55e)" }}>
              {metrics.fcm_ok_count}
            </div>
          </div>
          <div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>FCM fails</div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 600,
                color: metrics.fcm_fail_count > 0 ? "var(--danger, #ef4444)" : undefined,
              }}
            >
              {metrics.fcm_fail_count}
            </div>
          </div>
        </div>
      )}

      {stuckBusy.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Stuck BUSY creators</h3>
          <table>
            <thead>
              <tr>
                <th>Creator</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {stuckBusy.map((c) => (
                <tr key={c.user_id}>
                  <td>
                    {c.name || c.username || c.user_id}
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{c.user_id}</div>
                  </td>
                  <td>
                    <span className="badge warn">{c.status}</span>
                  </td>
                  <td>
                    <button
                      className="btn danger"
                      onClick={async () => {
                        await adminAPI.forceOffline(c.user_id);
                        toast.success("Creator forced offline");
                        load();
                      }}
                    >
                      Force offline
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Call</th>
              <th>Type</th>
              <th>Status</th>
              <th>Caller</th>
              <th>Creator</th>
              <th>Rate</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.call_id}>
                <td>{c.call_id}</td>
                <td>{c.call_type}</td>
                <td>
                  <span className={`badge ${c.status === "LIVE" ? "" : "warn"}`}>{c.status}</span>
                </td>
                <td>{c.caller_id}</td>
                <td>{c.receiver_id}</td>
                <td>₹{c.rate_per_minute}/min</td>
                <td className="row">
                  <button
                    className="btn ghost"
                    onClick={async () => {
                      try {
                        const r = await adminAPI.monitorToken(c.channel_name);
                        const d = r.data;
                        const params = new URLSearchParams({
                          appId: d.appId,
                          channel: d.channel_name,
                          token: d.token,
                          uid: String(d.uid),
                        });
                        window.open(`/monitor?${params.toString()}`, "_blank", "width=1200,height=800");
                      } catch {
                        toast.error("Could not generate monitor token");
                      }
                    }}
                  >
                    Monitor
                  </button>
                  <button
                    className="btn danger"
                    onClick={async () => {
                      await adminAPI.forceEnd(c.call_id);
                      toast.success("Call force-ended");
                      load();
                    }}
                  >
                    Force end
                  </button>
                </td>
              </tr>
            ))}
            {!calls.length && (
              <tr>
                <td colSpan={7} style={{ color: "var(--muted)" }}>
                  No active calls
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
