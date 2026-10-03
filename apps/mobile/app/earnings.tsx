import { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import { earningsAPI, withdrawalAPI } from "../src/services/api";
import { AppText, EmptyState, ScreenHeader } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

const PERIODS = ["day", "week", "month"] as const;

function inr(n: number | undefined) {
  return `₹${Number(n || 0).toFixed(2)}`;
}

export default function EarningsScreen() {
  const [overview, setOverview] = useState<any>({});
  const [breakdown, setBreakdown] = useState<any[]>([]);
  const [calls, setCalls] = useState<any[]>([]);
  const [gifts, setGifts] = useState<any>({ gifts: [], total_gifts: 0, total_gift_amount: 0 });
  const [requests, setRequests] = useState<any[]>([]);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("month");

  const load = useCallback(async () => {
    const [o, b, c, g, r] = await Promise.all([
      earningsAPI.overview(),
      earningsAPI.breakdown(period),
      earningsAPI.calls(20),
      earningsAPI.gifts(20),
      withdrawalAPI.requests(),
    ]);
    setOverview(o.data.overview || {});
    setBreakdown(b.data.breakdown || []);
    setCalls(c.data.calls || []);
    setGifts(g.data);
    setRequests(r.data.requests || []);
  }, [period]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => {});
    }, [load])
  );

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Earnings" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
        <View style={styles.grid}>
          <Metric label="Available" value={inr(overview.available_balance)} highlight />
          <Metric label="Lifetime" value={inr(overview.total_earnings)} />
          <Metric label="Pending payout" value={inr(overview.pending_withdrawals)} />
          <Metric label="Commission paid" value={inr(overview.total_commission_deducted)} />
        </View>

        <AppText variant="label" style={styles.section}>Call earnings</AppText>
        <View style={styles.chips}>
          {PERIODS.map((p) => (
            <Pressable key={p} onPress={() => setPeriod(p)} style={[styles.chip, period === p && styles.chipOn]}>
              <AppText style={{ color: period === p ? theme.colors.onBrand : theme.colors.text, fontSize: 13 }}>
                {p === "day" ? "Daily" : p === "week" ? "Weekly" : "Monthly"}
              </AppText>
            </Pressable>
          ))}
        </View>
        <View style={styles.card}>
          {breakdown.length ? (
            breakdown.map((row, i) => (
              <View key={row.period} style={[styles.line, i === breakdown.length - 1 && styles.lineLast]}>
                <AppText style={styles.lineLabel}>{row.period}</AppText>
                <AppText style={styles.lineVal}>{inr(row.earnings)}</AppText>
              </View>
            ))
          ) : (
            <AppText variant="caption" style={styles.muted}>No call earnings in this period.</AppText>
          )}
        </View>

        <AppText variant="label" style={styles.section}>Recent calls</AppText>
        <View style={styles.card}>
          {calls.length ? (
            calls.map((c, i) => (
              <View key={c.call_id} style={[styles.line, i === calls.length - 1 && styles.lineLast]}>
                <View style={{ flex: 1 }}>
                  <AppText style={styles.lineLabel}>{c.caller_name}</AppText>
                  <AppText variant="caption">
                    {c.call_type} · {Math.floor((c.duration_seconds || 0) / 60)}m
                  </AppText>
                </View>
                <AppText style={styles.lineVal}>{inr(c.model_earnings)}</AppText>
              </View>
            ))
          ) : (
            <AppText variant="caption" style={styles.muted}>No completed calls yet.</AppText>
          )}
        </View>

        <AppText variant="label" style={styles.section}>Gifts received</AppText>
        <View style={styles.card}>
          <View style={styles.giftSummary}>
            <AppText style={styles.lineLabel}>{gifts.total_gifts || 0} gifts</AppText>
            <AppText style={styles.lineVal}>{inr(gifts.total_gift_amount)}</AppText>
          </View>
          {(gifts.gifts || []).slice(0, 10).map((g: any, i: number) => (
            <View key={g.transaction_id} style={[styles.line, i === (gifts.gifts.length - 1) && styles.lineLast]}>
              <AppText variant="caption" style={{ flex: 1 }}>
                {g.description || "Gift"}
              </AppText>
              <AppText style={styles.lineVal}>{inr(g.amount)}</AppText>
            </View>
          ))}
        </View>

        <AppText variant="label" style={styles.section}>Withdrawals</AppText>
        <View style={styles.card}>
          {requests.length ? (
            requests.map((w, i) => (
              <View key={w.request_id} style={[styles.line, i === requests.length - 1 && styles.lineLast]}>
                <View style={{ flex: 1 }}>
                  <AppText style={styles.lineLabel}>{inr(w.amount)}</AppText>
                  <AppText variant="caption">{w.upi_id}</AppText>
                </View>
                <View style={[styles.status, w.status === "PAID" && styles.statusPaid]}>
                  <AppText variant="caption" color={w.status === "PAID" ? theme.colors.success : theme.colors.warning}>
                    {w.status}
                  </AppText>
                </View>
              </View>
            ))
          ) : (
            <AppText variant="caption" style={styles.muted}>No withdrawals yet.</AppText>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={[styles.metric, highlight && styles.metricHighlight]}>
      <AppText variant="caption">{label}</AppText>
      <AppText style={[styles.metricVal, highlight && { color: theme.colors.brandLight }]}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: {
    width: "47.5%",
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
  },
  metricHighlight: { borderColor: "rgba(45,212,191,0.4)" },
  metricVal: { fontFamily: theme.font.display, fontSize: 22, color: theme.colors.text, marginTop: 6 },
  section: { marginTop: 24, marginBottom: 10 },
  chips: { flexDirection: "row", gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.backgroundElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  line: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  lineLast: { borderBottomWidth: 0 },
  lineLabel: { fontFamily: theme.font.bodySemi, color: theme.colors.text },
  lineVal: { fontFamily: theme.font.bodyBold, color: theme.colors.brandLight },
  giftSummary: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  status: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(217,119,6,0.12)",
  },
  statusPaid: { backgroundColor: "rgba(34,197,94,0.12)" },
  muted: { marginVertical: 12 },
});
