import { View, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { theme } from "../src/theme/tokens";
import { useAuthStore } from "../src/store/authStore";

export default function PendingApproval() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);

  return (
    <View style={styles.wrap}>
      <Text style={styles.brand}>Voxora</Text>
      <Text style={styles.title}>Under review</Text>
      <Text style={styles.sub}>
        Your live selfie and rates are with our team. You'll get a push when you're approved and can take instant calls.
      </Text>
      <PrimaryButton label="Refresh status" onPress={() => router.replace("/")} style={{ marginTop: 24 }} />
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
  brand: { fontSize: 32, fontWeight: "800", color: theme.colors.brand },
  title: { fontSize: 26, fontWeight: "700", color: theme.colors.text, marginTop: 16 },
  sub: { color: theme.colors.textSecondary, marginTop: 12, lineHeight: 22 },
});
