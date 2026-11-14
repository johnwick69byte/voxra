import { useCallback, useEffect, useState } from "react";
import { View, FlatList, StyleSheet, Pressable, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { chatAPI } from "../../src/services/api";
import { useAuthStore } from "../../src/store/authStore";
import { useChatStore } from "../../src/store/chatStore";
import { socketService } from "../../src/services/socket";
import { AppText, Avatar, EmptyState } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";

function formatWhen(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function ChatInboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const isCreator = user?.user_type === "creator";
  const setUnread = useChatStore((s) => s.setUnread);
  const [items, setItems] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await chatAPI.conversations();
      setItems(res.data.conversations || []);
      setUnread(Number(res.data?.unread_total || 0));
    } finally {
      setRefreshing(false);
    }
  }, [setUnread]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    const onMessage = () => {
      load();
    };
    socketService.on("chat_message", onMessage);
    return () => socketService.off("chat_message", onMessage);
  }, [load]);

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 12 }]}>
      <AppText style={styles.title}>Chat</AppText>
      <AppText variant="caption" style={styles.sub}>
        {isCreator ? "Replies are free" : "₹1 per message you send"}
      </AppText>
      <FlatList
        data={items}
        keyExtractor={(item) => item.conversation_id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={load} tintColor={theme.colors.brandLight} />
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 8 }}
        ListEmptyComponent={
          isCreator ? (
            <EmptyState
              title="No chats yet"
              subtitle="Fans who message you will show up here. Replies are free."
            />
          ) : (
            <EmptyState
              title="No chats yet"
              subtitle="Open a creator and start a chat. Each message you send costs ₹1."
              actionLabel="Discover creators"
              onAction={() => router.push("/(tabs)/browse")}
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push(`/chat/${item.conversation_id}`)}
          >
            <Avatar uri={item.peer_picture} name={item.peer_name} size={52} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <View style={styles.nameRow}>
                <AppText style={styles.name} numberOfLines={1}>
                  {item.peer_name || "Chat"}
                </AppText>
                <AppText variant="caption">{formatWhen(item.last_message_at)}</AppText>
              </View>
              <AppText variant="caption" numberOfLines={1} style={{ marginTop: 4 }}>
                {item.last_message || "No messages yet"}
              </AppText>
            </View>
            {item.unread > 0 ? (
              <View style={styles.badge}>
                <AppText style={styles.badgeText}>{item.unread > 9 ? "9+" : item.unread}</AppText>
              </View>
            ) : null}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  title: {
    fontFamily: theme.font.display,
    fontSize: 32,
    color: theme.colors.text,
    paddingHorizontal: 20,
    letterSpacing: -0.6,
  },
  sub: { paddingHorizontal: 20, marginTop: 4, marginBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, fontFamily: theme.font.bodyBold, fontSize: 16, color: theme.colors.text },
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: theme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  badgeText: { color: theme.colors.onBrand, fontSize: 11, fontFamily: theme.font.bodyBold },
});
