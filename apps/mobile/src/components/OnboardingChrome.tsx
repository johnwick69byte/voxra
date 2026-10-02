import { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "./ui";
import { theme } from "../theme/tokens";

export function OnboardingChrome({
  step,
  total = 4,
  title,
  subtitle,
  children,
  onBack,
}: {
  step?: number;
  total?: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onBack?: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const goBack = onBack || (() => router.back());

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <View style={styles.top}>
        <Pressable onPress={goBack} hitSlop={12}>
          <AppText color={theme.colors.brandLight}>Back</AppText>
        </Pressable>
        {step ? (
          <AppText variant="caption" color={theme.colors.textMuted}>
            {step} of {total}
          </AppText>
        ) : (
          <View />
        )}
      </View>
      {step ? (
        <View style={styles.track}>
          {Array.from({ length: total }).map((_, i) => (
            <View key={i} style={[styles.dot, i < step ? styles.dotOn : null]} />
          ))}
        </View>
      ) : null}
      <AppText variant="title" style={{ marginTop: 16 }}>
        {title}
      </AppText>
      {subtitle ? (
        <AppText variant="subtitle" style={{ marginTop: 6, marginBottom: 8 }}>
          {subtitle}
        </AppText>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, paddingHorizontal: 20 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  track: { flexDirection: "row", gap: 6, marginTop: 14 },
  dot: { flex: 1, height: 4, borderRadius: 4, backgroundColor: theme.colors.surface },
  dotOn: { backgroundColor: theme.colors.brandLight },
});
