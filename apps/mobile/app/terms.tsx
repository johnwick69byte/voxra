import { View, Text, StyleSheet, ScrollView } from "react-native";
import { theme } from "../src/theme/tokens";

export default function Terms() {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 24, paddingTop: 64 }}>
      <Text style={styles.title}>Terms of Service</Text>
      <Text style={styles.body}>
        By using Voxora you agree to respectful conduct during instant calls. Abuse or nudity may
        result in immediate bans. Wallet recharges are prepaid credits for audio/video sessions and
        are non-refundable once used. Creators are independent providers; Voxora facilitates
        connections and collects a platform commission.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  title: { fontSize: 28, fontWeight: "800", color: theme.colors.brand, marginBottom: 16 },
  body: { fontSize: 16, lineHeight: 24, color: theme.colors.textSecondary },
});
