import { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import { appAPI } from "../src/services/api";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { AppText, Input } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

export default function SupportScreen() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await appAPI.supportMessages();
      setHistory(res.data.messages || []);
    } catch {
      /* ignore */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const submit = async () => {
    if (subject.trim().length < 2 || message.trim().length < 5) {
      Toast.show({ type: "error", text1: "Add a subject and a message" });
      return;
    }
    setLoading(true);
    try {
      await appAPI.support(subject.trim(), message.trim());
      Toast.show({ type: "success", text1: "Message sent", text2: "Our team will reply soon." });
      setSubject("");
      setMessage("");
      await load();
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Could not send",
        text2: e?.response?.data?.detail || e.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <AppText style={styles.title}>Support</AppText>
      </View>
      <AppText variant="subtitle" style={styles.sub}>
        Send us a problem or a question. You can also email gambiraojas6@gmail.com.
      </AppText>
      <Input label="Subject" value={subject} onChangeText={setSubject} placeholder="How can we help?" />
      <Input
        label="Message"
        value={message}
        onChangeText={setMessage}
        placeholder="Describe the issue"
        multiline
        style={{ height: 120, textAlignVertical: "top", paddingTop: 12 }}
      />
      <PrimaryButton label="Send to support" onPress={submit} loading={loading} style={{ marginTop: 16 }} />

      {history.length > 0 ? (
        <View style={{ marginTop: 28 }}>
          <AppText variant="label" style={styles.histLabel}>
            Your messages
          </AppText>
          {history.map((m) => (
            <View key={m.message_id} style={styles.msgCard}>
              <AppText style={styles.msgSubject}>{m.subject}</AppText>
              <AppText variant="caption" style={{ marginTop: 4 }}>
                {m.message}
              </AppText>
              {m.reply ? (
                <View style={styles.reply}>
                  <AppText variant="caption" color={theme.colors.brandLight}>
                    Support replied:
                  </AppText>
                  <AppText variant="caption">{m.reply}</AppText>
                </View>
              ) : (
                <AppText variant="caption" color={theme.colors.textMuted} style={{ marginTop: 6 }}>
                  {String(m.status || "open").toUpperCase()}
                </AppText>
              )}
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, paddingHorizontal: 24, paddingTop: 56 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.backgroundElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontFamily: theme.font.display, fontSize: 28, color: theme.colors.brand },
  sub: { marginBottom: 16 },
  histLabel: { marginBottom: 8 },
  msgCard: {
    backgroundColor: theme.colors.backgroundElevated,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  msgSubject: { fontFamily: theme.font.bodyBold, color: theme.colors.text },
  reply: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
});
