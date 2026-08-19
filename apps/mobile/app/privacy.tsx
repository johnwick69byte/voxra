import { View, Text, StyleSheet, ScrollView } from "react-native";
import { theme } from "../src/theme/tokens";

export default function Privacy() {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 24, paddingTop: 64 }}>
      <Text style={styles.title}>Privacy Policy</Text>
      <Text style={styles.body}>
        Voxora collects account, device, and call metadata required to operate instant audio/video
        sessions and wallet payments. We do not sell personal data. Push tokens are used only for
        call and account notifications. You may request account deletion from Profile.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  title: { fontSize: 28, fontWeight: "800", color: theme.colors.brand, marginBottom: 16 },
  body: { fontSize: 16, lineHeight: 24, color: theme.colors.textSecondary },
});
