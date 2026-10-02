import { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import { creatorsAPI } from "../src/services/api";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { theme } from "../src/theme/tokens";
import { APP_NAME } from "../src/theme/brand";

export default function PricingSetup() {
  const router = useRouter();
  const [audio, setAudio] = useState("10");
  const [video, setVideo] = useState("20");
  const [loading, setLoading] = useState(false);

  const save = async () => {
    const audioRate = Number(audio);
    const videoRate = Number(video);
    if (!audio.trim() || !video.trim() || Number.isNaN(audioRate) || Number.isNaN(videoRate)) {
      Toast.show({ type: "error", text1: "Enter both rates" });
      return;
    }
    if (audioRate < 3 || videoRate < 7) {
      Toast.show({ type: "error", text1: "Minimum ₹3 audio and ₹7 video" });
      return;
    }
    setLoading(true);
    try {
      const res = await creatorsAPI.pricingSetup({
        audio_rate_per_minute: audioRate,
        video_rate_per_minute: videoRate,
        instant_call_enabled: true,
      });
      if (res.data?.next_step === "home") {
        Toast.show({ type: "success", text1: "Rates updated" });
        router.replace("/(tabs)/browse");
        return;
      }
      Toast.show({ type: "success", text1: "Rates saved", text2: "Next: live selfie" });
      router.replace("/verification-selfie");
    } catch (e: any) {
      Toast.show({ type: "error", text1: "Save failed", text2: e?.response?.data?.detail });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.brand}>{APP_NAME}</Text>
      <Text style={styles.title}>Your call rates</Text>
      <Text style={styles.sub}>Instant audio & video only — no appointments.</Text>
      <Text style={styles.label}>Audio ₹/min (min 3)</Text>
      <TextInput style={styles.input} keyboardType="decimal-pad" value={audio} onChangeText={setAudio} />
      <Text style={styles.label}>Video ₹/min (min 7)</Text>
      <TextInput style={styles.input} keyboardType="decimal-pad" value={video} onChangeText={setVideo} />
      <PrimaryButton label="Submit for review" onPress={save} loading={loading} style={{ marginTop: 24 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, paddingTop: 72, backgroundColor: theme.colors.background },
  brand: { fontSize: 28, fontWeight: "800", color: theme.colors.brand },
  title: { fontSize: 24, fontWeight: "700", marginTop: 12, color: theme.colors.text },
  sub: { color: theme.colors.textSecondary, marginBottom: 24, marginTop: 6 },
  label: { fontWeight: "600", color: theme.colors.textSecondary, marginTop: 12, marginBottom: 6 },
  input: { height: 52, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 14, paddingHorizontal: 16, backgroundColor: theme.colors.backgroundElevated, fontSize: 16, color: theme.colors.text },
});
