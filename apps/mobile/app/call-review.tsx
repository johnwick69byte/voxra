import { useState } from "react";
import { View, StyleSheet, TextInput, Pressable, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Toast from "react-native-toast-message";
import { callsAPI, creatorsAPI } from "../src/services/api";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { AppText } from "../src/components/ui";
import { theme } from "../src/theme/tokens";
import { APP_NAME } from "../src/theme/brand";

export default function CallReview() {
  const { callId, peerName, peerId } = useLocalSearchParams<{
    callId: string;
    peerName?: string;
    peerId?: string;
  }>();
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  const done = () => router.replace("/(tabs)/browse");

  const submit = async () => {
    if (!callId) {
      done();
      return;
    }
    setLoading(true);
    try {
      await callsAPI.review(String(callId), rating, comment.trim() || undefined);
      Toast.show({ type: "success", text1: "Thanks for the review" });
    } catch {
      /* optional */
    } finally {
      setLoading(false);
      done();
    }
  };

  const report = () => {
    Alert.alert("Report user", "Why are you reporting this call?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Harassment",
        onPress: async () => {
          try {
            await callsAPI.report(String(callId), "harassment");
            Toast.show({ type: "success", text1: "Report submitted" });
          } catch {
            Toast.show({ type: "error", text1: "Could not report" });
          }
        },
      },
      {
        text: "Spam / scam",
        onPress: async () => {
          try {
            await callsAPI.report(String(callId), "spam");
            Toast.show({ type: "success", text1: "Report submitted" });
          } catch {
            Toast.show({ type: "error", text1: "Could not report" });
          }
        },
      },
    ]);
  };

  const block = () => {
    if (!peerId) {
      Toast.show({ type: "info", text1: "Block unavailable for this session" });
      return;
    }
    Alert.alert("Block user?", "You won't see this creator in browse.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: async () => {
          try {
            await creatorsAPI.block(String(peerId));
            Toast.show({ type: "success", text1: "User blocked" });
            done();
          } catch {
            Toast.show({ type: "error", text1: "Could not block" });
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.wrap}>
      <AppText style={styles.brand}>{APP_NAME}</AppText>
      <View style={styles.card}>
        <AppText variant="title" style={{ textAlign: "center" }}>
          How was your call?
        </AppText>
        <AppText variant="subtitle" style={{ textAlign: "center", marginTop: 6 }}>
          {peerName || "Creator"}
        </AppText>

        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable key={n} onPress={() => setRating(n)} hitSlop={6}>
              <Ionicons
                name={n <= rating ? "star" : "star-outline"}
                size={40}
                color={n <= rating ? theme.colors.accent : theme.colors.textMuted}
              />
            </Pressable>
          ))}
        </View>

        <TextInput
          style={styles.input}
          placeholder="Optional comment"
          placeholderTextColor={theme.colors.textMuted}
          value={comment}
          onChangeText={setComment}
          multiline
        />

        <PrimaryButton label="Submit review" onPress={submit} loading={loading} style={{ marginTop: 18 }} />
        <PrimaryButton label="Skip" variant="ghost" onPress={done} style={{ marginTop: 10 }} />
      </View>

      <View style={styles.safety}>
        <Pressable onPress={report} style={styles.safetyBtn}>
          <Ionicons name="flag" size={16} color={theme.colors.error} />
          <AppText color={theme.colors.error} style={styles.safetyLink}>
            Report
          </AppText>
        </Pressable>
        <Pressable onPress={block} style={styles.safetyBtn}>
          <Ionicons name="ban" size={16} color={theme.colors.error} />
          <AppText color={theme.colors.error} style={styles.safetyLink}>
            Block
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, padding: 20, paddingTop: 64 },
  brand: { fontFamily: theme.font.display, fontSize: 28, color: theme.colors.brand, marginBottom: 16 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 22,
  },
  stars: { flexDirection: "row", justifyContent: "center", gap: 10, marginTop: 20 },
  input: {
    marginTop: 20,
    minHeight: 100,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    padding: 14,
    backgroundColor: theme.colors.backgroundElevated,
    textAlignVertical: "top",
    color: theme.colors.text,
    fontFamily: theme.font.body,
  },
  safety: { flexDirection: "row", justifyContent: "center", gap: 16, marginTop: 24 },
  safetyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    backgroundColor: "rgba(239,68,68,0.08)",
  },
  safetyLink: { fontFamily: theme.font.bodySemi, fontSize: 14 },
});
