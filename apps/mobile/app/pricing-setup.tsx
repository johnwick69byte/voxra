import { useState } from "react";
import { TextInput, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import { creatorsAPI } from "../src/services/api";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { OnboardingChrome } from "../src/components/OnboardingChrome";
import { AppText } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

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
      <AppText variant="label" style={styles.label}>
        Audio ₹/min (min 3)
      </AppText>
      <TextInput
        style={styles.input}
        keyboardType="decimal-pad"
        value={audio}
        onChangeText={setAudio}
        placeholderTextColor={theme.colors.textMuted}
      />
      <AppText variant="label" style={styles.label}>
        Video ₹/min (min 7)
      </AppText>
      <TextInput
        style={styles.input}
        keyboardType="decimal-pad"
        value={video}
        onChangeText={setVideo}
        placeholderTextColor={theme.colors.textMuted}
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
  label: { marginTop: 16, marginBottom: 6 },
  input: {
    height: 52,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.backgroundElevated,
    fontSize: 16,
    color: theme.colors.text,
    fontFamily: theme.font.body,
  },
});
