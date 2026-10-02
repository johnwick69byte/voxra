import { useCallback, useState } from "react";
import { View, FlatList, StyleSheet, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { appAPI } from "../src/services/api";
import { useNotificationsStore } from "../src/store/notificationsStore";
import { AppText, EmptyState } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

export default function NotificationsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const setUnread = useNotificationsStore((s) => s.setUnread);
  const refreshCount = useNotificationsStore((s) => s.refresh);

  const load = useCallback(async () => {
    try {
      const res = await appAPI.notifications();
      setItems(res.data.notifications || []);
    } finally {
      await appAPI.markNotificationsRead().catch(() => {});
      setUnread(0);
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
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <AppText style={styles.title}>Updates</AppText>
      </View>
      <FlatList
        data={items}
        keyExtractor={(item, i) => String(item.notification_id || i)}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListEmptyComponent={
          <EmptyState title="No updates yet" subtitle="Approvals, broadcasts and account news show here." />
        }
        renderItem={({ item }) => (
          <View style={[styles.row, !item.read && styles.rowUnread]}>
            <View style={{ flex: 1 }}>
              <AppText style={styles.t}>{item.title}</AppText>
              <AppText style={styles.b}>{item.body}</AppText>
            </View>
            <Pressable
              onPress={() => remove(item.notification_id)}
              hitSlop={10}
              style={styles.delete}
            >
              <Ionicons name="close" size={18} color={theme.colors.textMuted} />
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, paddingTop: 56 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 8 },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.backgroundElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontFamily: theme.font.display, fontSize: 28, color: theme.colors.brand },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: theme.colors.backgroundElevated,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowUnread: { borderColor: theme.colors.brandLight },
  t: { fontFamily: theme.font.bodyBold, color: theme.colors.text },
  b: { color: theme.colors.textSecondary, marginTop: 4 },
  delete: { padding: 4, marginLeft: 8 },
});
