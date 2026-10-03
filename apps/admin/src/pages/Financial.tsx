import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { adminAPI } from "../services/api";

function inr(n: number | undefined) {
  return `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function Financial() {
  const [data, setData] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any[]>([]);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [rechargeCom, setRechargeCom] = useState<{ commissions: any[]; totals: any }>({
    commissions: [],
    totals: {},
  });
  const [comType, setComType] = useState<string>("");
  const [period, setPeriod] = useState<"day" | "week" | "month">("month");

  useEffect(() => {
    (async () => {
      const [d, o, c, tx, rc] = await Promise.all([
        adminAPI.financialDashboard(),
        adminAPI.financialOverview(),
        adminAPI.financialCommissions(),
        adminAPI.financialTransactions(),
        adminAPI.financialRechargeCommissions(50, comType || undefined),
      ]);
      setData(d.data);
      setOverview(o.data.overview);
      setCommissions(c.data.breakdown || []);
      setTransactions(tx.data.transactions || []);
      setRechargeCom(rc.data);
    })().catch(() => {});
  }, [comType]);

  useEffect(() => {
    adminAPI
      .financialAnalytics(period)
      .then((r) => setAnalytics(r.data.analytics || []))
      .catch(() => {});
  }, [period]);

  if (!data) return <p>Loading…</p>;

  const cards = [
    { label: "Approved creators", value: data.total_models },
    { label: "Total revenue", value: inr(data.total_revenue) },
    { label: "Total commission", value: inr(data.total_commission) },
    { label: "Platform wallet", value: inr(data.platform_wallet_balance) },
    { label: "Total withdrawals", value: inr(data.total_withdrawals) },
    { label: "Net profit", value: inr(data.net_profit) },
  ];

  return (
    <div>
      <h1 className="page-title">Financial dashboard</h1>
      <p className="page-sub">Money in, commission, payouts and platform balance.</p>

      <div className="grid">
        {cards.map((c) => (
          <div className="metric" key={c.label}>
            <div className="label">{c.label}</div>
            <div className="value">{c.value}</div>
          </div>
        ))}
      </div>

      {overview && (
        <div className="panel">
          <h3>Commission windows</h3>
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
            <div>
              <div className="metric .label" style={{ color: "var(--muted)", fontSize: 12 }}>Today</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{inr(overview.today_commissions)}</div>
            </div>
            <div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>This week</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{inr(overview.week_commissions)}</div>
            </div>
            <div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>This month</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{inr(overview.month_commissions)}</div>
            </div>
            <div>
              <div style={{ color: "var(--muted)", fontSize: 12 }}>Total payouts</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{inr(overview.total_payouts)}</div>
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ margin: 0 }}>Platform commission</h3>
          <div className="row">
            {([
              ["", "All"],
              ["RECHARGE_COMMISSION", "Recharge (6%)"],
              ["CALL_COMMISSION", "Call (15%)"],
              ["GIFT_COMMISSION", "Gift (15%)"],
            ] as const).map(([val, label]) => (
              <button
                key={label}
                className={comType === val ? "btn" : "btn ghost"}
                onClick={() => setComType(val as any)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 32, flexWrap: "wrap", margin: "12px 0" }}>
          <div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Total</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{inr(rechargeCom.totals?.total_commission)}</div>
          </div>
          <div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Gateway (recharge)</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{inr(rechargeCom.totals?.gateway_commission)}</div>
          </div>
          <div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>Entries</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{rechargeCom.totals?.count || 0}</div>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Source</th>
              <th>Gross</th>
              <th>Creator</th>
              <th>Commission</th>
            </tr>
          </thead>
          <tbody>
            {(rechargeCom.commissions || []).map((c) => (
              <tr key={c.commission_id}>
                <td>{c.created_at ? new Date(c.created_at).toLocaleString() : "—"}</td>
                <td><span className="badge">{c.type}</span></td>
                <td style={{ fontSize: 12, color: "var(--muted)" }}>
                  {c.source_id}
                  {c.minute ? ` · min ${c.minute}` : ""}
                </td>
                <td>{inr(c.gross_amount)}</td>
                <td>{inr(c.model_earnings)}</td>
                <td>{inr(c.amount)}</td>
              </tr>
            ))}
            {!(rechargeCom.commissions || []).length && (
              <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No commission yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Commission over time</h3>
          <div className="row">
            {(["day", "week", "month"] as const).map((p) => (
              <button
                key={p}
                className={period === p ? "btn" : "btn ghost"}
                onClick={() => setPeriod(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div style={{ width: "100%", height: 280, marginTop: 12 }}>
          <ResponsiveContainer>
            <LineChart data={analytics}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d9d2c7" />
              <XAxis dataKey="period" />
              <YAxis />
              <Tooltip formatter={(v: any) => inr(Number(v))} />
              <Line type="monotone" dataKey="commission" stroke="#0f766e" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel">
        <h3>Commission by creator</h3>
        <table>
          <thead>
            <tr>
              <th>Creator</th>
              <th>Calls</th>
              <th>Commission</th>
            </tr>
          </thead>
          <tbody>
            {commissions.map((c) => (
              <tr key={c.model_id}>
                <td>{c.model_name}</td>
                <td>{c.total_calls}</td>
                <td>{inr(c.total_commission)}</td>
              </tr>
            ))}
            {!commissions.length && (
              <tr><td colSpan={3} style={{ color: "var(--muted)" }}>No commission yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3>Recent transactions</h3>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>User</th>
              <th>Amount</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {transactions.slice(0, 50).map((t) => (
              <tr key={t.transaction_id}>
                <td><span className="badge">{t.type}</span></td>
                <td>{t.user_id}</td>
                <td>{inr(t.amount)}</td>
                <td>{t.created_at ? new Date(t.created_at).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
