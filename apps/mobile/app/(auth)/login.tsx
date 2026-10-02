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
import { APP_NAME } from "../../src/theme/brand";

const RESEND_COOLDOWN_S = 30;

function nationalDigits(raw: string) {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("91") && d.length >= 12) d = d.slice(2);
  else if (d.length > 10) d = d.slice(-10);
  return d.slice(0, 10);
}

function formatPhone(raw: string) {
  const d = nationalDigits(raw);
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
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const digits = nationalDigits(phone);
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
      const code = res.data?.dev ? res.data?.dev_code || null : null;
      setDevCode(code);
      Toast.show({
        type: "success",
        text1: "OTP sent",
        text2: code ? `Dev code: ${code}` : "Check your SMS",
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
      const res = await authAPI.verifyOtp(digits, otpDigits);
      await setSession(res.data.token, res.data.user);
      router.replace("/");
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
        <AppText style={styles.brand}>{APP_NAME}</AppText>
        <AppText style={styles.tagline}>
          Instant voice & video with creators you love.
        </AppText>
      </LinearGradient>
      <Animated.View entering={FadeInDown.duration(420)} style={styles.sheet}>
        <Input
          label="Phone"
          keyboardType="phone-pad"
          placeholder="98765 43210"
          value={formatPhone(phone)}
          onChangeText={(t) => setPhone(nationalDigits(t))}
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
        {devCode ? (
          <AppText variant="caption" style={{ marginTop: 8 }}>
            Dev code: {devCode}
          </AppText>
        ) : null}
        <PrimaryButton
          label={sent ? "Verify & continue" : "Send OTP"}
          onPress={sent ? verify : send}
          loading={loading}
          disabled={sent ? !otpOk : !phoneOk}
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
    fontSize: 42,
    color: theme.colors.text,
    letterSpacing: -1.4,
  },
  tagline: {
    marginTop: 14,
    fontSize: 17,
    fontFamily: theme.font.body,
    color: "rgba(243,239,232,0.88)",
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
});
