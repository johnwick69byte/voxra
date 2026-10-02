import { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import { authAPI } from "../../src/services/api";
import { useAuthStore } from "../../src/store/authStore";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { AppText } from "../../src/components/ui";
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
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [terms, setTerms] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const digits = nationalDigits(phone);
  const otpDigits = otp.replace(/\D/g, "");
  const phoneOk = digits.length === 10 && "6789".includes(digits[0]);
  const otpOk = otpDigits.length === 4;

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
    if (!terms) {
      Toast.show({ type: "error", text1: "Accept the terms to continue" });
      return;
    }
    if (cooldown > 0) return;
    setLoading(true);
    try {
      const res = await authAPI.sendOtp(digits);
      const id = res.data?.verification_id;
      if (!id) {
        Toast.show({ type: "error", text1: "Could not start verification", text2: "Request the code again." });
        return;
      }
      setVerificationId(id);
      setSent(true);
      startCooldown();
      Toast.show({
        type: "success",
        text1: "OTP sent",
        text2: "Check your phone for the 4-digit code. Valid for 15 minutes.",
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
      Toast.show({ type: "error", text1: "Enter the 4-digit OTP" });
      return;
    }
    if (!verificationId) {
      Toast.show({ type: "error", text1: "Request a new OTP" });
      return;
    }
    setLoading(true);
    try {
      const res = await authAPI.verifyOtp(digits, otpDigits, verificationId);
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
        <AppText variant="label" style={{ marginBottom: 8 }}>
          Phone number
        </AppText>
        <View style={styles.phoneRow}>
          <AppText style={styles.cc}>+91</AppText>
          <TextInput
            style={styles.phoneInput}
            keyboardType="phone-pad"
            placeholder="98765 43210"
            placeholderTextColor={theme.colors.textMuted}
            value={formatPhone(phone)}
            onChangeText={(t) => setPhone(nationalDigits(t))}
            maxLength={11}
          />
        </View>
        {digits.length > 0 && digits.length < 10 ? (
          <AppText variant="caption" color={theme.colors.textMuted} style={{ marginTop: 6 }}>
            {10 - digits.length} more digits
          </AppText>
        ) : null}
        {sent ? (
          <>
            <AppText variant="label" style={{ marginTop: 18, marginBottom: 8 }}>
              4-digit code
            </AppText>
            <TextInput
              style={styles.otpInput}
              keyboardType="number-pad"
              placeholder="----"
              placeholderTextColor={theme.colors.textMuted}
              value={otpDigits}
              onChangeText={(t) => setOtp(t.replace(/\D/g, "").slice(0, 4))}
              maxLength={4}
              autoFocus
            />
            <AppText variant="caption" style={{ marginTop: 8, lineHeight: 18 }}>
              OTP sent to +91 {formatPhone(digits)}{"\n"}
              Valid for 15 minutes • 4-digit code
            </AppText>
          </>
        ) : (
          <Pressable style={styles.termsRow} onPress={() => setTerms((v) => !v)}>
            <Ionicons
              name={terms ? "checkbox" : "square-outline"}
              size={22}
              color={terms ? theme.colors.brandLight : theme.colors.textMuted}
            />
            <AppText variant="caption" style={{ flex: 1, lineHeight: 18 }}>
              I agree to the{" "}
              <AppText variant="caption" color={theme.colors.brandLight} onPress={() => router.push("/terms")}>
                Terms
              </AppText>
              {" "}and{" "}
              <AppText variant="caption" color={theme.colors.brandLight} onPress={() => router.push("/privacy")}>
                Privacy Policy
              </AppText>
            </AppText>
          </Pressable>
        )}
        <PrimaryButton
          label={sent ? "Verify & continue" : "Send OTP"}
          onPress={sent ? verify : send}
          loading={loading}
          disabled={sent ? !otpOk : !phoneOk || !terms}
          style={{ marginTop: 20, opacity: sent ? (otpOk ? 1 : 0.5) : phoneOk && terms ? 1 : 0.5 }}
        />
        {sent ? (
          <Pressable
            onPress={send}
            disabled={cooldown > 0 || loading}
            style={{ marginTop: 14, alignItems: "center", opacity: cooldown > 0 ? 0.5 : 1 }}
          >
            <AppText variant="caption" color={theme.colors.brand}>
              {cooldown > 0 ? `Resend OTP in ${cooldown}s` : "Resend OTP"}
            </AppText>
          </Pressable>
          <Pressable
            onPress={() => {
              setSent(false);
              setOtp("");
              setVerificationId(null);
            }}
            style={{ marginTop: 10, alignItems: "center" }}
          >
            <AppText variant="caption" color={theme.colors.textMuted}>
              Change number
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
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.backgroundElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 56,
  },
  cc: { fontFamily: theme.font.bodyBold, marginRight: 10, color: theme.colors.brandLight },
  phoneInput: { flex: 1, color: theme.colors.text, fontSize: 18, fontFamily: theme.font.body },
  otpInput: {
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    color: theme.colors.text,
    fontSize: 28,
    letterSpacing: 12,
    textAlign: "center",
    fontFamily: theme.font.bodyBold,
  },
  termsRow: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 18 },
  otpCapture: { ...StyleSheet.absoluteFill, color: "transparent" },
  otpRow: { flexDirection: "row", gap: 8 },
  otpCell: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    backgroundColor: theme.colors.backgroundElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  otpCellOn: { borderColor: theme.colors.brandLight },
  otpDigit: { fontFamily: theme.font.bodyBold, fontSize: 22 },
  devBox: {
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.accent,
  },
  devCode: { fontFamily: theme.font.display, fontSize: 32, letterSpacing: 6, marginTop: 4 },
});
