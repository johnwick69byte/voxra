import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { View, ActivityIndicator, Pressable } from "react-native";
import { AppText } from "../src/components/ui";
import { useAuthStore } from "../src/store/authStore";
import { creatorsAPI } from "../src/services/api";
import { theme } from "../src/theme/tokens";

/**
 * Resume creator onboarding if they quit mid-flow.
 */
export default function Index() {
  const { token, user, loading } = useAuthStore();
  const [next, setNext] = useState<string | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (loading || !token || !user) return;
    if (!user.profile_complete) {
      setNext("complete_profile");
      return;
    }
    if (user.user_type !== "creator") {
      setNext("home");
      return;
    }
    setStatusError(false);
    setNext(null);
    creatorsAPI
      .onboardingStatus()
      .then((r) => setNext(r.data.next_step || "verification_selfie"))
      .catch(() => setStatusError(true));
  }, [loading, token, user, attempt]);

  if (statusError && user?.user_type === "creator") {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.colors.background, padding: 24 }}>
        <AppText variant="title">Can't continue yet</AppText>
        <AppText variant="subtitle" style={{ marginTop: 8, textAlign: "center" }}>
          We need to confirm your verification before opening the app.
        </AppText>
        <Pressable onPress={() => setAttempt((n) => n + 1)} style={{ marginTop: 20 }}>
          <AppText color={theme.colors.brandLight}>Try again</AppText>
        </Pressable>
      </View>
    );
  }

  if (loading || (token && user && !next)) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  if (!token) return <Redirect href="/(auth)/login" />;
  if (next === "complete_profile") return <Redirect href="/(auth)/complete-profile" />;
  if (next === "pricing_setup") return <Redirect href="/pricing-setup" />;
  if (next === "creator_photos") return <Redirect href="/creator-photos" />;
  if (next === "verification_selfie") return <Redirect href="/verification-selfie" />;
  if (next === "pending_approval") return <Redirect href="/pending-approval" />;
  return <Redirect href="/(tabs)/browse" />;
}
