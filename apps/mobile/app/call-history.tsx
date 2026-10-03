import { useCallback, useState } from "react";
import { View, FlatList, StyleSheet, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { callsAPI } from "../src/services/api";
import { AppText, EmptyState, ScreenHeader } from "../src/components/ui";
import { theme } from "../src/theme/tokens";
import { useAuthStore } from "../src/store/authStore";

function formatDuration(sec = 0) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export default function CallHistory() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [calls, setCalls] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await callsAPI.history();
      setCalls(res.data.calls || []);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Call history" subtitle={`${calls.length} calls`} />
      <FlatList
        data={calls}
        keyExtractor={(i) => i.call_id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={load} tintColor={theme.colors.brandLight} />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 8 }}
        ListEmptyComponent={<EmptyState title="No calls yet" subtitle="Your completed calls will show here." />}
        renderItem={({ item }) => {
          const isCaller = item.caller_id === user?.user_id;
          const peer =
            item.peer_name ||
            (isCaller ? item.receiver_name : item.caller_name) ||
            (isCaller ? "Creator" : "Fan");
          return (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <AppText style={styles.main}>{peer}</AppText>
                <AppText variant="caption" style={{ marginTop: 4 }}>
                  {item.call_type} · {item.status}
                </AppText>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <AppText style={styles.amt}>₹{(item.total_amount || 0).toFixed(0)}</AppText>
                <AppText variant="caption">{formatDuration(item.duration_seconds || 0)}</AppText>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  row: {
    flexDirection: "row",
    backgroundColor: theme.colors.surface,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  main: { fontFamily: theme.font.bodyBold, color: theme.colors.text, fontSize: 16 },
  amt: { fontFamily: theme.font.bodyBold, color: theme.colors.brandLight },
});
