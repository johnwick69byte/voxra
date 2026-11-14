import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Toast from "react-native-toast-message";
import { chatAPI } from "../../src/services/api";
import { useAuthStore } from "../../src/store/authStore";
import { useChatStore } from "../../src/store/chatStore";
import { socketService } from "../../src/services/socket";
import { setOpenChatThread } from "../../src/services/activeChat";
import { AppText, ScreenHeader } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";

function newClientId() {
  return `cmsg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function ChatThreadScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const refreshUnread = useChatStore((s) => s.refresh);
  const listRef = useRef<FlatList>(null);
  const pendingId = useRef<string | null>(null);

  const [messages, setMessages] = useState<any[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [role, setRole] = useState<"fan" | "creator">("fan");
  const [balance, setBalance] = useState<number | null>(null);
  const [price, setPrice] = useState(1);
  const [peerName, setPeerName] = useState("Chat");

  const isFan = role === "fan";
  const canAfford = !isFan || (balance != null && balance >= price);

  const load = useCallback(async () => {
    if (!conversationId) return;
    try {
      const [thread, inbox] = await Promise.all([
        chatAPI.messages(conversationId),
        chatAPI.conversations(),
      ]);
      setMessages(thread.data.messages || []);
      setRole(thread.data.role === "creator" ? "creator" : "fan");
      setBalance(thread.data.balance != null ? Number(thread.data.balance) : null);
      setPrice(Number(thread.data.message_price || 1));
      const peer = (inbox.data.conversations || []).find(
        (row: any) => row.conversation_id === conversationId
      );
      if (peer?.peer_name) setPeerName(peer.peer_name);
      refreshUnread();
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Could not open chat",
        text2: e?.response?.data?.detail || e.message,
      });
    } finally {
      setLoading(false);
    }
  }, [conversationId, refreshUnread]);

  useFocusEffect(
    useCallback(() => {
      setOpenChatThread(conversationId || null);
      load();
      return () => setOpenChatThread(null);
    }, [conversationId, load])
  );

  useEffect(() => {
    const onMessage = (payload: any) => {
      if (!payload || payload.conversation_id !== conversationId) return;
      setMessages((prev) => {
        if (prev.some((row) => row.message_id === payload.message_id)) return prev;
        return [...prev, payload];
      });
      chatAPI.markRead(conversationId).then(() => refreshUnread()).catch(() => {});
    };
    socketService.on("chat_message", onMessage);
    return () => socketService.off("chat_message", onMessage);
  }, [conversationId, refreshUnread]);

  const send = async () => {
    const text = draft.trim();
    if (!conversationId || !text || sending || !canAfford) return;
    const clientId = pendingId.current || newClientId();
    pendingId.current = clientId;
    setSending(true);
    try {
      const res = await chatAPI.send(conversationId, text, clientId);
      const message = res.data?.message;
      pendingId.current = null;
      setDraft("");
      if (res.data?.balance != null) setBalance(Number(res.data.balance));
      if (message) {
        setMessages((prev) => {
          if (prev.some((row) => row.message_id === message.message_id)) return prev;
          return [...prev, message];
        });
      }
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 402) {
        pendingId.current = null;
        setBalance((current) => (current == null || current >= price ? Math.max(price - 0.01, 0) : current));
        Toast.show({
          type: "error",
          text1: "Not enough balance",
          text2: "Add money to your wallet to send a message.",
        });
      } else {
        Toast.show({
          type: "error",
          text1: "Message not sent",
          text2: e?.response?.data?.detail || "Please try again.",
        });
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScreenHeader title={peerName} subtitle={isFan ? `₹${price} per message` : "Replies are free"} />
      {loading ? (
        <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.message_id}
          contentContainerStyle={{ padding: 16, gap: 8, flexGrow: 1 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <AppText variant="caption" style={{ textAlign: "center", marginTop: 24 }}>
              {isFan ? "Say hello. Your first message costs ₹" + price + "." : "No messages yet."}
            </AppText>
          }
          renderItem={({ item }) => {
            const mine = item.sender_id === user?.user_id;
            return (
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                <AppText style={[styles.bubbleText, mine && styles.mineText]}>{item.text}</AppText>
                {Number(item.price) > 0 ? (
                  <AppText style={[styles.price, mine && styles.minePrice]}>₹{Number(item.price)}</AppText>
                ) : null}
              </View>
            );
          }}
        />
      )}

      {isFan && balance != null && balance < price ? (
        <Pressable style={styles.lowBalance} onPress={() => router.push("/(tabs)/wallet")}>
          <Ionicons name="wallet-outline" size={16} color={theme.colors.warning} />
          <AppText style={styles.lowBalanceText}>Add money to send a message</AppText>
        </Pressable>
      ) : null}

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {isFan ? (
          <AppText variant="caption" style={styles.balanceHint}>
            {balance == null ? "Wallet" : `Wallet ₹${balance.toFixed(0)} · ₹${price} per message`}
          </AppText>
        ) : null}
        <View style={styles.composerRow}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={isFan ? "Message" : "Reply"}
            placeholderTextColor={theme.colors.textMuted}
            multiline
            maxLength={1000}
          />
          <Pressable
            onPress={send}
            disabled={!draft.trim() || sending || !canAfford}
            style={[styles.send, (!draft.trim() || sending || !canAfford) && styles.sendOff]}
          >
            {sending ? (
              <ActivityIndicator color={theme.colors.onBrand} size="small" />
            ) : (
              <Ionicons name="send" size={18} color={theme.colors.onBrand} />
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  mine: { alignSelf: "flex-end", backgroundColor: theme.colors.brand },
  theirs: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  bubbleText: { color: theme.colors.text, fontFamily: theme.font.body, fontSize: 15, lineHeight: 21 },
  mineText: { color: theme.colors.onBrand },
  price: { marginTop: 4, fontSize: 11, color: theme.colors.textMuted, fontFamily: theme.font.bodySemi },
  minePrice: { color: "rgba(255,255,255,0.75)" },
  lowBalance: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(245,158,11,0.12)",
  },
  lowBalanceText: { color: theme.colors.warning, fontFamily: theme.font.bodySemi, fontSize: 13 },
  composer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: theme.colors.backgroundElevated,
  },
  balanceHint: { marginBottom: 6, marginLeft: 4 },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    fontFamily: theme.font.body,
    fontSize: 15,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  sendOff: { opacity: 0.45 },
});
