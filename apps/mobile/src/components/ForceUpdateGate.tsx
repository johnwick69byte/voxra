import { useEffect, useState } from "react";
import { Modal, View, Text, StyleSheet, Linking, Platform } from "react-native";
import Constants from "expo-constants";
import { appAPI } from "../services/api";
import { theme } from "../theme/tokens";
import { PrimaryButton } from "./PrimaryButton";

function cmp(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export function ForceUpdateGate() {
  const [required, setRequired] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await appAPI.config();
        const current = Constants.expoConfig?.version || "1.0.0";
        const min =
          Platform.OS === "ios"
            ? res.data.min_version_ios
            : res.data.min_version_android;
        if (min && cmp(current, min) < 0) setRequired(true);
      } catch {
        /* offline — skip */
      }
    })();
  }, []);

  if (!required) return null;
  return (
    <Modal visible animationType="fade">
      <View style={styles.wrap}>
        <Text style={styles.brand}>Voxora</Text>
        <Text style={styles.title}>Update required</Text>
        <Text style={styles.body}>A newer version is required to continue. Instant calls and payments need the latest build.</Text>
        <PrimaryButton
          label="Update now"
          onPress={() =>
            Linking.openURL(
              Platform.OS === "ios"
                ? "https://apps.apple.com"
                : "https://play.google.com/store"
            )
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: "center",
    padding: 32,
  },
  brand: {
    fontSize: theme.font.size.hero,
    fontWeight: "800",
    color: theme.colors.brand,
    marginBottom: 12,
  },
  title: { fontSize: 24, fontWeight: "700", color: theme.colors.text, marginBottom: 8 },
  body: { fontSize: 16, color: theme.colors.textSecondary, marginBottom: 24, lineHeight: 22 },
});
