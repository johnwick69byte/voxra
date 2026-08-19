import { useState } from "react";
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import { authAPI } from "../../src/services/api";
import { useAuthStore } from "../../src/store/authStore";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { AppText, Input } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";

function formatPhone(raw: string) {
  const d = raw.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)} ${d.slice(5)}`;
}

export default function LoginScreen() {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<"user" | "creator">("user");
  const [devHint, setDevHint] = useState(false);

  const digits = phone.replace(/\D/g, "");

  const send = async () => {
    if (digits.length < 10) {
      Toast.show({ type: "error", text1: "Enter a valid 10-digit mobile" });
      return;
    }
    setLoading(true);
    try {
      const res = await authAPI.sendOtp(digits);
      setSent(true);
      const isDev = res.data?.dev === true;
      setDevHint(isDev && __DEV__);
      Toast.show({
        type: "success",
        text1: "OTP sent",
        text2: isDev && __DEV__ ? "Dev mode — check API logs" : "Check your SMS",
      });
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Failed to send OTP",
        text2: e?.response?.data?.detail || e?.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setLoading(true);
    try {
      const res = await authAPI.verifyOtp(digits, otp, role);
      await setSession(res.data.token, res.data.user);
      if (!res.data.user.profile_complete) router.replace("/(auth)/complete-profile");
      else router.replace("/(tabs)/browse");
    } catch {
      Toast.show({ type: "error", text1: "Invalid OTP" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <LinearGradient colors={[...theme.gradients.hero]} style={styles.hero}>
        <AppText style={styles.brand}>Voxora</AppText>
        <AppText style={styles.tagline}>
          Instant voice & video with creators you love.
        </AppText>
      </LinearGradient>
      <View style={styles.sheet}>
        <View style={styles.roleRow}>
          {(["user", "creator"] as const).map((r) => (
            <Pressable
              key={r}
              onPress={() => setRole(r)}
              style={[styles.roleChip, role === r && styles.roleActive]}
            >
              <AppText
                style={[styles.roleText, role === r && styles.roleTextActive]}
              >
                {r === "user" ? "Fan" : "Creator"}
              </AppText>
            </Pressable>
          ))}
        </View>
        <Input
          label="Phone"
          keyboardType="phone-pad"
          placeholder="98765 43210"
          value={formatPhone(phone)}
          onChangeText={(t) => setPhone(t.replace(/\D/g, "").slice(0, 10))}
          maxLength={11}
        />
        {sent && (
          <Input
            label="OTP"
            keyboardType="number-pad"
            placeholder="6-digit code"
            value={otp}
            onChangeText={setOtp}
            maxLength={6}
          />
        )}
        {devHint ? (
          <AppText variant="caption" style={{ marginTop: 8 }}>
            Development OTP is configured on the API.
          </AppText>
        ) : null}
        <PrimaryButton
          label={sent ? "Verify & continue" : "Send OTP"}
          onPress={sent ? verify : send}
          loading={loading}
          style={{ marginTop: 20 }}
        />
        {sent ? (
          <Pressable onPress={send} style={{ marginTop: 14, alignItems: "center" }}>
            <AppText variant="caption" color={theme.colors.brand}>
              Resend code
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hero: {
    paddingTop: 88,
    paddingHorizontal: 28,
    paddingBottom: 56,
    minHeight: "44%",
  },
  brand: {
    fontFamily: theme.font.display,
    fontSize: 52,
    color: "#F7F4EF",
    letterSpacing: -1.4,
  },
  tagline: {
    marginTop: 14,
    fontSize: 17,
    fontFamily: theme.font.body,
    color: "rgba(247,244,239,0.88)",
    maxWidth: 280,
    lineHeight: 24,
  },
  sheet: {
    flex: 1,
    marginTop: -28,
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
  },
  roleRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  roleChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
  },
  roleActive: { backgroundColor: theme.colors.brand },
  roleText: {
    fontFamily: theme.font.bodySemi,
    color: theme.colors.textSecondary,
  },
  roleTextActive: { color: "#fff" },
});
