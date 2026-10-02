import { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { earningsAPI, withdrawalAPI } from "../src/services/api";
import { AppText, Card, EmptyState } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

const PERIODS = ["day", "week", "month"] as const;

function inr(n: number | undefined) {
  return `₹${Number(n || 0).toFixed(2)}`;
}

export default function EarningsScreen() {
  const router = useRouter();
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
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 48 }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <AppText style={styles.title}>Earnings</AppText>
      </View>

      <View style={styles.grid}>
        <Card style={styles.metric}>
          <AppText variant="caption">Available</AppText>
          <AppText style={styles.metricVal}>{inr(overview.available_balance)}</AppText>
        </Card>
        <Card style={styles.metric}>
          <AppText variant="caption">Lifetime</AppText>
          <AppText style={styles.metricVal}>{inr(overview.total_earnings)}</AppText>
        </Card>
        <Card style={styles.metric}>
          <AppText variant="caption">Pending payout</AppText>
          <AppText style={styles.metricVal}>{inr(overview.pending_withdrawals)}</AppText>
        </Card>
        <Card style={styles.metric}>
          <AppText variant="caption">Commission paid</AppText>
          <AppText style={styles.metricVal}>{inr(overview.total_commission_deducted)}</AppText>
        </Card>
      </View>

      <AppText variant="label" style={styles.section}>
        Call earnings
      </AppText>
      <View style={styles.chips}>
        {PERIODS.map((p) => (
          <Pressable
            key={p}
            onPress={() => setPeriod(p)}
            style={[styles.chip, period === p && styles.chipOn]}
          >
            <AppText style={{ color: period === p ? theme.colors.onBrand : theme.colors.text }}>
              {p}
            </AppText>
          </Pressable>
        ))}
      </View>
      {breakdown.length ? (
        breakdown.map((row) => (
          <View key={row.period} style={styles.line}>
            <AppText>{row.period}</AppText>
            <AppText color={theme.colors.brandLight}>{inr(row.earnings)}</AppText>
          </View>
        ))
      ) : (
        <AppText variant="caption" style={styles.muted}>
          No call earnings in this period.
        </AppText>
      )}

      <AppText variant="label" style={styles.section}>
        Recent calls
      </AppText>
      {calls.length ? (
        calls.map((c) => (
          <View key={c.call_id} style={styles.line}>
            <View>
              <AppText>{c.caller_name}</AppText>
              <AppText variant="caption">
                {c.call_type} · {Math.floor((c.duration_seconds || 0) / 60)}m
              </AppText>
            </View>
            <AppText color={theme.colors.brandLight}>{inr(c.model_earnings)}</AppText>
          </View>
        ))
      ) : (
        <AppText variant="caption" style={styles.muted}>
          No completed calls yet.
        </AppText>
      )}

      <AppText variant="label" style={styles.section}>
        Gifts received
      </AppText>
      <AppText variant="caption" style={styles.muted}>
        {gifts.total_gifts} gifts · {inr(gifts.total_gift_amount)} total
      </AppText>
      {(gifts.gifts || []).slice(0, 10).map((g: any) => (
        <View key={g.transaction_id} style={styles.line}>
          <AppText variant="caption">{g.description || "Gift"}</AppText>
          <AppText color={theme.colors.brandLight}>{inr(g.amount)}</AppText>
        </View>
      ))}

      <AppText variant="label" style={styles.section}>
        Withdrawals
      </AppText>
      {requests.length ? (
        requests.map((w) => (
          <View key={w.request_id} style={styles.line}>
            <View>
              <AppText>{inr(w.amount)}</AppText>
              <AppText variant="caption">{w.upi_id}</AppText>
            </View>
            <AppText variant="caption">{w.status}</AppText>
          </View>
        ))
      ) : (
        <EmptyState title="No withdrawals" subtitle="Your payout requests will show here." />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, paddingHorizontal: 20, paddingTop: 56 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.backgroundElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontFamily: theme.font.display, fontSize: 28, color: theme.colors.brand },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metric: { width: "47%", padding: 14 },
  metricVal: { fontFamily: theme.font.display, fontSize: 22, color: theme.colors.text, marginTop: 4 },
  section: { marginTop: 24, marginBottom: 8 },
  chips: { flexDirection: "row", gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
  },
  chipOn: { backgroundColor: theme.colors.brand },
  line: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  muted: { marginTop: 8 },
});
