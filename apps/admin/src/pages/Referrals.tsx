import { useEffect, useState } from "react";
import { adminAPI } from "../services/api";

function inr(n: number | undefined) {
  return `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function Referrals() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminAPI
      .modelReferrals()
      .then((res) => setData(res.data))
      .catch((e) => setError(e?.response?.data?.detail || "Could not load referral data"));
  }, []);

  if (error) return <p>{error}</p>;
  if (!data) return <p>Loading…</p>;

  const cards = [
    { label: "Bonuses paid", value: inr(data.total_bonuses_paid) },
    { label: "This month", value: inr(data.this_month_bonus) },
    { label: "Bonuses", value: data.bonus_count },
    { label: "Active referrers", value: data.active_referrers },
    { label: "Referred creators", value: data.referred_models },
    { label: "Paid withdrawals", value: data.models_with_paid_withdrawals },
    { label: "Conversion", value: `${data.conversion_rate}%` },
  ];

  return (
    <div>
      <h1 className="page-title">Creator referrals</h1>
      <p className="page-sub">
        Creator-to-creator referral payouts. Bonuses are paid once per completed withdrawal.
      </p>

      <div className="grid">
        {cards.map((card) => (
          <div className="metric" key={card.label}>
            <div className="label">{card.label}</div>
            <div className="value">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>Top referrers</h3>
        {(data.top_referrers || []).length === 0 ? (
          <p>No referral bonuses paid yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Creator</th>
                <th>Referrals paid</th>
                <th>Total bonus</th>
              </tr>
            </thead>
            <tbody>
              {(data.top_referrers || []).map((referrer: any) => (
                <tr key={referrer.user_id}>
                  <td>
                    <strong>{referrer.name}</strong>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>
                      {referrer.phone_masked || referrer.user_id}
                    </div>
                  </td>
                  <td>{referrer.bonus_count}</td>
                  <td>{inr(referrer.total_bonus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h3>Recent bonuses</h3>
        {(data.recent_bonuses || []).length === 0 ? (
          <p>No bonuses paid yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Referred creator</th>
                <th>Withdrawal</th>
                <th>Bonus</th>
                <th>Request</th>
              </tr>
            </thead>
            <tbody>
              {(data.recent_bonuses || []).map((bonus: any) => (
                <tr key={bonus.withdrawal_request_id}>
                  <td>
                    {bonus.created_at
                      ? new Date(bonus.created_at).toLocaleString("en-IN")
                      : "—"}
                  </td>
                  <td>{bonus.referred_model_name}</td>
                  <td>{inr(bonus.withdrawal_amount)}</td>
                  <td>
                    <span className="badge ok">{inr(bonus.bonus_amount)}</span>
                  </td>
                  <td style={{ fontSize: 12 }}>{bonus.withdrawal_request_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
