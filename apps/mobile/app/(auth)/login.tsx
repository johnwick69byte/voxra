import { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import { authAPI } from "../../src/services/api";
import { useAuthStore } from "../../src/store/authStore";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { AppText, Input } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";

const RESEND_COOLDOWN_S = 30;

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
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const digits = phone.replace(/\D/g, "");
  const otpDigits = otp.replace(/\D/g, "");
  const phoneOk = digits.length === 10 && "6789".includes(digits[0]);
  const otpOk = otpDigits.length === 6;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCooldown = () => {
    setCooldown(RESEND_COOLDOWN_S);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const send = async () => {
    if (!phoneOk) {
      Toast.show({ type: "error", text1: "Enter a valid 10-digit mobile" });
      return;
    }
    if (cooldown > 0) return;
    setLoading(true);
    try {
      const res = await authAPI.sendOtp(digits);
      setSent(true);
      startCooldown();
      const isDev = res.data?.dev === true;
      setDevHint(isDev && __DEV__);
      Toast.show({
        type: "success",
        text1: "OTP sent",
        text2: isDev && __DEV__ ? "Dev mode — check API logs" : "Check your SMS",
      });
    } catch (e: any) {
      const status = e?.response?.status;
      Toast.show({
        type: "error",
        text1: status === 429 ? "Too many requests" : "Failed to send OTP",
        text2: e?.response?.data?.detail || e?.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    if (!otpOk) {
      Toast.show({ type: "error", text1: "Enter the 6-digit OTP" });
      return;
    }
    setLoading(true);
    try {
      const res = await authAPI.verifyOtp(digits, otpDigits, role);
      await setSession(res.data.token, res.data.user);
      if (!res.data.user.profile_complete) router.replace("/(auth)/complete-profile");
      else router.replace("/(tabs)/browse");
    } catch (e: any) {
      const status = e?.response?.status;
      Toast.show({
        type: "error",
        text1: status === 429 ? "Too many attempts" : "Invalid OTP",
        text2: e?.response?.data?.detail,
      });
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
      <Animated.View entering={FadeInDown.duration(420)} style={styles.sheet}>
        <View style={styles.roleRow}>
          {(["user", "creator"] as const).map((r) => (
            <Pressable
              key={r}
              onPress={() => setRole(r)}
              style={[styles.roleChip, role === r && styles.roleActive]}
            >
              <AppText style={[styles.roleText, role === r && styles.roleTextActive]}>
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
            value={otpDigits}
            onChangeText={(t) => setOtp(t.replace(/\D/g, "").slice(0, 6))}
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
          style={{ marginTop: 20, opacity: sent ? (otpOk ? 1 : 0.5) : phoneOk ? 1 : 0.5 }}
        />
        {sent ? (
          <Pressable
            onPress={send}
            disabled={cooldown > 0 || loading}
            style={{ marginTop: 14, alignItems: "center", opacity: cooldown > 0 ? 0.5 : 1 }}
          >
            <AppText variant="caption" color={theme.colors.brand}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
            </AppText>
          </Pressable>
        ) : null}
      </Animated.View>
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
