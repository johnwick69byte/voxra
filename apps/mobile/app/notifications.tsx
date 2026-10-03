import { useCallback, useState } from "react";
import { View, FlatList, StyleSheet, Pressable, RefreshControl } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { appAPI } from "../src/services/api";
import { useNotificationsStore } from "../src/store/notificationsStore";
import { AppText, EmptyState, ScreenHeader } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

export default function NotificationsScreen() {
  const [items, setItems] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const setUnread = useNotificationsStore((s) => s.setUnread);
  const refreshCount = useNotificationsStore((s) => s.refresh);

  const load = useCallback(async (spin = false) => {
    if (spin) setRefreshing(true);
    try {
      const res = await appAPI.notifications();
      setItems(res.data.notifications || []);
    } finally {
      await appAPI.markNotificationsRead().catch(() => {});
      setUnread(0);
      if (spin) setRefreshing(false);
    }
  }, [setUnread]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const remove = async (id: string) => {
    setItems((prev) => prev.filter((n) => n.notification_id !== id));
    await appAPI.deleteNotification(id).catch(() => {});
    refreshCount();
  };

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Updates" subtitle="Approvals, broadcasts and account news" />
      <FlatList
        data={items}
        keyExtractor={(item, i) => String(item.notification_id || i)}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 8 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.colors.brandLight} />
        }
        ListEmptyComponent={
          <EmptyState title="No updates yet" subtitle="Approvals, broadcasts and account news show here." />
        }
        renderItem={({ item }) => (
          <View style={[styles.row, !item.read && styles.rowUnread]}>
            <View style={[styles.dot, item.read && styles.dotRead]} />
            <View style={{ flex: 1 }}>
              <AppText style={styles.t}>{item.title}</AppText>
              <AppText style={styles.b}>{item.body}</AppText>
            </View>
            <Pressable onPress={() => remove(item.notification_id)} hitSlop={10} style={styles.delete}>
              <Ionicons name="close" size={18} color={theme.colors.textMuted} />
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: theme.colors.surface,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowUnread: { borderColor: theme.colors.brandLight },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.brandLight,
    marginTop: 6,
  },
  dotRead: { backgroundColor: theme.colors.textMuted, opacity: 0.4 },
  t: { fontFamily: theme.font.bodyBold, color: theme.colors.text },
  b: { color: theme.colors.textSecondary, marginTop: 4, lineHeight: 20 },
  delete: { padding: 4, marginLeft: 4 },
});
