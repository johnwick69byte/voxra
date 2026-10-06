import { useEffect, useState } from "react";
import { View, StyleSheet, Image, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { AppText } from "../src/components/ui";
import { theme } from "../src/theme/tokens";
import { useAuthStore } from "../src/store/authStore";
import { creatorsAPI } from "../src/services/api";

export default function PendingApproval() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const logout = useAuthStore((s) => s.logout);
  const [status, setStatus] = useState<string | null>(null);
  const [gesture, setGesture] = useState<number | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);

  const refresh = async () => {
    try {
      const res = await creatorsAPI.onboardingStatus();
      setStatus(res.data.verification_status || null);
      setGesture(res.data.gesture_number ?? null);
      setSelfie(res.data.verification_selfie_url || null);
      setImages(res.data.images || []);
      // Approved while this screen was open -- fall through to the app.
      if (res.data.is_approved || res.data.next_step === "home") {
        router.replace("/(tabs)/browse");
        return;
      }
      if (res.data.next_step && res.data.next_step !== "pending_approval") {
        const map: Record<string, string> = {
          complete_profile: "/(auth)/complete-profile",
          pricing_setup: "/pricing-setup",
          creator_photos: "/creator-photos",
          verification_selfie: "/verification-selfie",
        };
        const href = map[res.data.next_step];
        if (href) router.replace(href as never);
      }
    } catch {
      router.replace("/");
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const rejected = status === "rejected";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={[styles.wrap, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
    >
      <View style={[styles.statusIcon, rejected && styles.statusIconRejected]}>
        <Ionicons
          name={rejected ? "close-circle" : "time"}
          size={44}
          color={rejected ? theme.colors.error : theme.colors.warning}
        />
      </View>
      <AppText variant="title" style={{ textAlign: "center" }}>
        {rejected ? "Verification rejected" : "Under review"}
      </AppText>
      <AppText variant="subtitle" style={{ marginTop: 12, textAlign: "center" }}>
        {rejected
          ? "Retake the live selfie and match the new finger count. Your face and fingers need to be clear."
          : "Your photos and live selfie are with our team. You'll get a notification when you're approved."}
      </AppText>

      {gesture || selfie || images.length ? (
        <View style={styles.card}>
          <AppText variant="label">Your submission</AppText>
          {gesture ? (
            <AppText style={{ marginTop: 8 }}>
              Gesture: {gesture} finger{gesture === 1 ? "" : "s"}
            </AppText>
          ) : null}
          {selfie ? <Image source={{ uri: selfie }} style={styles.selfie} /> : null}
          {images.length ? (
            <View style={styles.row}>
              {images.map((url) => (
                <Image key={url} source={{ uri: url }} style={styles.thumb} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {rejected ? (
        <PrimaryButton
          label="Retake selfie"
          onPress={() => router.replace("/verification-selfie")}
          style={{ marginTop: 24 }}
        />
      ) : (
        <PrimaryButton label="Refresh status" onPress={refresh} style={{ marginTop: 24 }} />
      )}
      <PrimaryButton
        label="Use the app while you wait"
        variant="ghost"
        onPress={() => router.replace("/(tabs)/browse")}
        style={{ marginTop: 12 }}
      />
      <PrimaryButton
        label="Log out"
        variant="ghost"
        onPress={async () => {
          await logout();
          router.replace("/(auth)/login");
        }}
        style={{ marginTop: 12 }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 24, alignItems: "stretch" },
  statusIcon: {
    alignSelf: "center",
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(217,119,6,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  statusIconRejected: { backgroundColor: "rgba(239,68,68,0.12)" },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 18,
    marginTop: 24,
  },
  selfie: { width: 160, height: 200, borderRadius: 16, marginTop: 12, backgroundColor: theme.colors.backgroundElevated },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  thumb: { width: 72, height: 72, borderRadius: 12, backgroundColor: theme.colors.backgroundElevated },
});
