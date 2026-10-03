import { useCallback, useState } from "react";
import { View, FlatList, StyleSheet, Pressable, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { creatorsAPI, callsAPI } from "../../src/services/api";
import { useAuthStore } from "../../src/store/authStore";
import { StatusDot } from "../../src/components/StatusDot";
import { AppText, Avatar, EmptyState } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";

function formatDuration(sec = 0) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export default function FollowingScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isCreator = user?.user_type === "creator";
  const [items, setItems] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      if (isCreator) {
        const res = await callsAPI.history();
        setItems(res.data.calls || []);
      } else {
        const res = await creatorsAPI.following();
        setItems(res.data.creators || res.data.models || []);
      }
    } finally {
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, [isCreator]));

  if (isCreator) {
    return (
      <View style={styles.wrap}>
        <AppText style={styles.title}>Calls</AppText>
        <FlatList
          data={items}
          keyExtractor={(i) => i.call_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={theme.colors.brandLight} />}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          ListEmptyComponent={<EmptyState title="No calls yet" subtitle="Stay online to receive instant calls." />}
          renderItem={({ item }) => {
            const isCaller = item.caller_id === user?.user_id;
            const peer =
              item.peer_name || (isCaller ? item.receiver_name : item.caller_name) || (isCaller ? "Creator" : "Fan");
            return (
              <Pressable
                style={styles.row}
                onPress={() =>
                  router.push({
                    pathname: "/call-review",
                    params: { callId: item.call_id, peerName: peer, peerId: isCaller ? item.receiver_id : item.caller_id },
                  })
                }
              >
                <View style={{ flex: 1 }}>
                  <AppText style={styles.name}>{peer}</AppText>
                  <AppText variant="caption" style={{ marginTop: 4 }}>
                    {item.call_type} · {item.status}
                  </AppText>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <AppText style={styles.amt}>₹{(item.total_amount || 0).toFixed(0)}</AppText>
                  <AppText variant="caption">{formatDuration(item.duration_seconds || 0)}</AppText>
                </View>
              </Pressable>
            );
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <AppText style={styles.title}>Following</AppText>
      <FlatList
        data={items}
        keyExtractor={(i) => i.user_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={theme.colors.brandLight} />}
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
        ListEmptyComponent={<EmptyState title="Nothing here yet" subtitle="Follow creators to see them here." />}
        renderItem={({ item }) => (
          <Pressable style={styles.followRow} onPress={() => router.push(`/creator/${item.user_id}`)}>
            <Avatar uri={item.picture || (item.images || [])[0]} name={item.name} size={52} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <AppText style={styles.name}>{item.name}</AppText>
              <StatusDot status={item.status} />
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, paddingTop: 64 },
  title: {
    fontFamily: theme.font.display,
    fontSize: 32,
    color: theme.colors.brand,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    padding: 14,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  followRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  name: { fontFamily: theme.font.bodyBold, color: theme.colors.text, fontSize: 16 },
  amt: { fontFamily: theme.font.bodyBold, color: theme.colors.brandLight },
});
