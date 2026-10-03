import { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, Pressable } from "react-native";
import Toast from "react-native-toast-message";
import { useFocusEffect } from "expo-router";
import { appAPI } from "../src/services/api";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { AppText, Input, ScreenHeader } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

export default function SupportScreen() {
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
    <View style={styles.wrap}>
      <ScreenHeader title="Help & support" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <AppText variant="subtitle" style={{ marginBottom: 8 }}>
          Send us a problem or a question. You can also email gambiraojas6@gmail.com.
        </AppText>

        <View style={styles.card}>
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
        </View>

        {history.length > 0 ? (
          <>
            <AppText variant="label" style={{ marginTop: 24, marginBottom: 8 }}>
              Your messages
            </AppText>
            {history.map((m) => (
              <View key={m.message_id} style={styles.msgCard}>
                <View style={styles.msgHead}>
                  <AppText style={styles.msgSubject}>{m.subject}</AppText>
                  <View style={[styles.status, m.status === "replied" && styles.statusDone]}>
                    <AppText variant="caption" color={m.status === "replied" ? theme.colors.success : theme.colors.warning}>
                      {String(m.status || "open").toUpperCase()}
                    </AppText>
                  </View>
                </View>
                <AppText variant="caption" style={{ marginTop: 6, lineHeight: 20 }}>
                  {m.message}
                </AppText>
                {m.reply ? (
                  <View style={styles.reply}>
                    <AppText variant="caption" color={theme.colors.brandLight}>
                      Support replied
                    </AppText>
                    <AppText variant="caption" style={{ marginTop: 2, lineHeight: 20 }}>
                      {m.reply}
                    </AppText>
                  </View>
                ) : null}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 18,
    marginTop: 8,
  },
  msgCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  msgHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  msgSubject: { fontFamily: theme.font.bodyBold, color: theme.colors.text, flex: 1 },
  status: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(217,119,6,0.12)",
  },
  statusDone: { backgroundColor: "rgba(34,197,94,0.12)" },
  reply: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
});
