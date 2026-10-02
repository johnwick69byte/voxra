import { useState } from "react";
import { TextInput, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import { creatorsAPI } from "../src/services/api";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { OnboardingChrome } from "../src/components/OnboardingChrome";
import { AppText } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

function keep(raw: string) {
  const n = Number(raw);
  if (!raw.trim() || Number.isNaN(n)) return null;
  return Math.round(n * 0.85);
}

function RateCard({
  title,
  hint,
  value,
  onChange,
  keep: kept,
}: {
  title: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  keep: number | null;
}) {
  return (
    <View style={styles.card}>
      <AppText variant="label">{title}</AppText>
      <AppText variant="caption" color={theme.colors.textMuted}>
        {hint}
      </AppText>
      <View style={styles.rateRow}>
        <AppText style={styles.rupee}>₹</AppText>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          value={value}
          onChangeText={onChange}
          placeholderTextColor={theme.colors.textMuted}
        />
        <AppText color={theme.colors.textMuted}>/ min</AppText>
      </View>
      <AppText variant="caption" color={theme.colors.accent}>
        {kept == null ? "You keep about 85% after the platform fee." : `You keep about ₹${kept} each minute.`}
      </AppText>
    </View>
  );
}

export default function PricingSetup() {
  const router = useRouter();
  const [audio, setAudio] = useState("10");
  const [video, setVideo] = useState("20");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    const audioRate = Number(audio);
    const videoRate = Number(video);
    if (!audio.trim() || !video.trim() || Number.isNaN(audioRate) || Number.isNaN(videoRate)) {
      setError("Enter both rates");
      return;
    }
    if (audioRate < 3 || videoRate < 7) {
      setError("Minimum ₹3 audio and ₹7 video");
      return;
    }
    setError("");
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
      router.replace("/creator-photos");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not save rates");
    } finally {
      setLoading(false);
    }
  };

  return (
    <OnboardingChrome
      step={2}
      title="Your call rates"
      subtitle="Instant audio and video. Fans pay this per minute."
      onBack={() => router.replace("/(auth)/complete-profile")}
    >
      <RateCard
        title="Audio"
        hint="Minimum ₹3 / min"
        value={audio}
        onChange={setAudio}
        keep={keep(audio)}
      />
      <RateCard
        title="Video"
        hint="Minimum ₹7 / min"
        value={video}
        onChange={setVideo}
        keep={keep(video)}
      />
      {error ? (
        <AppText variant="caption" color={theme.colors.error} style={{ marginTop: 8 }}>
          {error}
        </AppText>
      ) : null}
      <PrimaryButton label="Continue to photos" onPress={save} loading={loading} style={{ marginTop: 24 }} />
    </OnboardingChrome>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 14,
    padding: 16,
    borderRadius: 18,
    backgroundColor: theme.colors.surface,
    gap: 6,
  },
  rateRow: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 4 },
  rupee: { fontFamily: theme.font.display, fontSize: 28, color: theme.colors.text },
  input: {
    flex: 1,
    height: 52,
    fontSize: 28,
    color: theme.colors.text,
    fontFamily: theme.font.display,
  },
});
