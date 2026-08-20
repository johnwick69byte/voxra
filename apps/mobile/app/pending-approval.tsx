import { useEffect, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { AppText } from "../src/components/ui";
import { theme } from "../src/theme/tokens";
import { useAuthStore } from "../src/store/authStore";
import { creatorsAPI } from "../src/services/api";

export default function PendingApproval() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await creatorsAPI.onboardingStatus();
      setStatus(res.data.verification_status || null);
      if (res.data.next_step === "home") {
        router.replace("/(tabs)/browse");
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
    <View style={styles.wrap}>
      <AppText style={styles.brand}>Voxora</AppText>
      <AppText variant="title" style={{ marginTop: 16 }}>
        {rejected ? "Verification rejected" : "Under review"}
      </AppText>
      <AppText variant="subtitle" style={{ marginTop: 12 }}>
        {rejected
          ? "Please retake a clear live selfie and resubmit. Contact support if this keeps happening."
          : "Your live selfie and rates are with our team. You'll get a push when you're approved and can take instant calls."}
      </AppText>
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
        label="Log out"
        variant="ghost"
        onPress={async () => {
          await logout();
          router.replace("/(auth)/login");
        }}
        style={{ marginTop: 12 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, padding: 24, paddingTop: 80 },
  brand: { fontFamily: theme.font.display, fontSize: 32, color: theme.colors.brand },
});
