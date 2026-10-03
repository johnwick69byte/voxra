import { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "./ui";
import { theme } from "../theme/tokens";

const STEP_NAMES = ["Profile", "Rates", "Photos", "Selfie"];

export function OnboardingChrome({
  step,
  total = 4,
  title,
  subtitle,
  children,
  onBack,
  footer,
}: {
  step?: number;
  total?: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onBack?: () => void;
  footer?: ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const goBack = onBack || (() => router.back());

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 10 }]}>
      <View style={styles.top}>
        <Pressable onPress={goBack} style={styles.back} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          {step ? (
            <AppText variant="caption" color={theme.colors.accent}>
              {STEP_NAMES[step - 1] || "Step"} · {step} of {total}
            </AppText>
          ) : null}
          <AppText style={styles.title} variant="title">
            {title}
          </AppText>
        </View>
      </View>
      {step ? (
        <View style={styles.track}>
          {Array.from({ length: total }).map((_, i) => (
            <View key={i} style={[styles.bar, i < step ? styles.barOn : null]} />
          ))}
        </View>
      ) : null}
      {subtitle ? (
        <AppText variant="subtitle" style={styles.sub}>
          {subtitle}
        </AppText>
      ) : null}
      <View style={styles.body}>{children}</View>
      {footer ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>{footer}</View>
      ) : (
        <View style={{ height: Math.max(insets.bottom, 12) }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, paddingHorizontal: 20 },
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  track: { flexDirection: "row", gap: 6, marginTop: 16 },
  bar: { flex: 1, height: 4, borderRadius: 4, backgroundColor: theme.colors.surface },
  barOn: { backgroundColor: theme.colors.brandLight },
  title: { marginTop: 2 },
  sub: { marginTop: 10, lineHeight: 22 },
  body: { flex: 1, marginTop: 8 },
  footer: {
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
});
