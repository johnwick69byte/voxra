import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { useAuthStore } from "../src/store/authStore";
import { creatorsAPI } from "../src/services/api";
import { theme } from "../src/theme/tokens";

/**
 * Resume creator onboarding if they quit mid-flow.
 */
export default function Index() {
  const { token, user, loading } = useAuthStore();
  const [next, setNext] = useState<string | null>(null);

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
    creatorsAPI
      .onboardingStatus()
      .then((r) => setNext(r.data.next_step || "home"))
      .catch(() => setNext("home"));
  }, [loading, token, user]);

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
  if (next === "verification_selfie") return <Redirect href="/verification-selfie" />;
  if (next === "pending_approval") return <Redirect href="/pending-approval" />;
  return <Redirect href="/(tabs)/browse" />;
}
