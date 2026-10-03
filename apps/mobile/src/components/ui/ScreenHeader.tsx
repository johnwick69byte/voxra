import { ReactNode } from "react";
import { View, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "./Text";
import { theme } from "../../theme/tokens";

/**
 * Consistent header for secondary screens: a bordered back button + title,
 * with an optional right-side action. Use on any pushed (non-tab) screen.
 */
export function ScreenHeader({
  title,
  subtitle,
  right,
  onBack,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
      <Pressable
        onPress={onBack || (() => router.back())}
        style={styles.back}
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <AppText style={styles.title}>{title}</AppText>
        {subtitle ? <AppText variant="caption">{subtitle}</AppText> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: theme.colors.backgroundElevated,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontFamily: theme.font.displayMedium,
    fontSize: 22,
    color: theme.colors.text,
    letterSpacing: -0.3,
  },
});
