import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import { adminAPI } from "../services/api";

export default function Overview() {
  const [metrics, setMetrics] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const [o, a] = await Promise.all([adminAPI.overview(), adminAPI.analytics("weekly")]);
      setMetrics(o.data.metrics);
      setAnalytics(a.data);
    })();
  }, []);

  if (!metrics) return <p>Loading…</p>;

  const cards = [
    { label: "Users", value: metrics.total_users },
    { label: "Creators", value: metrics.total_creators },
    { label: "Pending review", value: metrics.pending_creators },
    { label: "Active calls", value: metrics.active_calls },
    { label: "GMV (7d)", value: `₹${Number(metrics.gmv_week).toFixed(0)}` },
    { label: "Commission (7d)", value: `₹${Number(metrics.commission_week).toFixed(0)}` },
    { label: "Calls today", value: metrics.calls_today },
    { label: "Miss rate today", value: `${metrics.miss_rate_today}%` },
    { label: "Platform wallet", value: `₹${Number(metrics.platform_wallet).toFixed(0)}` },
  ];

  return (
    <div>
      <h1 className="page-title">Overview</h1>
      <p className="page-sub">Live business insights — real data from the API (no mock charts).</p>
      <div className="grid">
        {cards.map((c) => (
          <div className="metric" key={c.label}>
            <div className="label">{c.label}</div>
            <div className="value">{c.value}</div>
          </div>
        ))}
      </div>
      <div className="panel">
        <h3>Recharge (7 days)</h3>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={analytics?.recharge_series || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d9d2c7" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="amount" stroke="#0f766e" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="panel">
        <h3>Calls & revenue</h3>
        <div style={{ width: "100%", height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={analytics?.call_series || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d9d2c7" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="calls" fill="#0f766e" />
              <Bar dataKey="revenue" fill="#e8a87c" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="panel">
        <h3>Top creators (earnings)</h3>
        <table>
          <thead>
            <tr><th>Creator</th><th>Calls</th><th>Earnings</th></tr>
          </thead>
          <tbody>
            {(analytics?.top_creators || []).map((c: any) => (
              <tr key={c._id}>
                <td>{c._id}</td>
                <td>{c.calls}</td>
                <td>₹{Number(c.earnings).toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
