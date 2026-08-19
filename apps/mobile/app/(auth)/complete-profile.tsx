import { useState } from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import { authAPI } from "../../src/services/api";
import { useAuthStore } from "../../src/store/authStore";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { theme } from "../../src/theme/tokens";

export default function CompleteProfile() {
  const router = useRouter();
  const { user, refreshMe } = useAuthStore();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [referral, setReferral] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      Toast.show({ type: "error", text1: "Name is required" });
      return;
    }
    setLoading(true);
    try {
      await authAPI.completeProfile({
        name: name.trim(),
        username: username.trim() || undefined,
        referral_code: referral.trim() || undefined,
        user_type: user?.user_type || "user",
      });
      await refreshMe();
      if (user?.user_type === "creator") router.replace("/pricing-setup");
      else router.replace("/");
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Could not save profile",
        text2: e?.response?.data?.detail || e.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.brand}>Voxora</Text>
      <Text style={styles.title}>Almost there</Text>
      <Text style={styles.sub}>A short profile so creators and fans know who you are.</Text>
      <Text style={styles.label}>Display name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={theme.colors.textMuted} />
      <Text style={styles.label}>Username (optional)</Text>
      <TextInput style={styles.input} autoCapitalize="none" value={username} onChangeText={setUsername} placeholder="unique_handle" placeholderTextColor={theme.colors.textMuted} />
      <Text style={styles.label}>Referral code (optional)</Text>
      <TextInput style={styles.input} autoCapitalize="characters" value={referral} onChangeText={setReferral} placeholder="ABCD1234" placeholderTextColor={theme.colors.textMuted} />
      <PrimaryButton label="Continue" onPress={submit} loading={loading} style={{ marginTop: 24 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, paddingTop: 72, backgroundColor: theme.colors.background },
  brand: { fontSize: 28, fontWeight: "800", color: theme.colors.brand, marginBottom: 8 },
  title: { fontSize: 26, fontWeight: "700", color: theme.colors.text },
  sub: { color: theme.colors.textSecondary, marginTop: 6, marginBottom: 24, lineHeight: 22 },
  label: { fontSize: 13, fontWeight: "600", color: theme.colors.textSecondary, marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    height: 52,
    paddingHorizontal: 16,
    fontSize: 16,
    color: theme.colors.text,
  },
});
