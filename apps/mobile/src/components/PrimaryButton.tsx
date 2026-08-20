import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from "react-native";
import { theme } from "../theme/tokens";

export function PrimaryButton({
  label,
  onPress,
  loading,
  variant = "primary",
  style,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  variant?: "primary" | "ghost" | "danger";
  style?: ViewStyle;
}) {
  const bg =
    variant === "danger"
      ? theme.colors.callRed
      : variant === "ghost"
        ? "transparent"
        : theme.colors.brand;
  return (
    <TouchableOpacity
      style={[
        styles.btn,
        variant === "primary" && styles.glow,
        {
          backgroundColor: bg,
          borderWidth: variant === "ghost" ? 1 : 0,
          borderColor: theme.colors.border,
        },
        style,
      ]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={variant === "ghost" ? theme.colors.brandLight : theme.colors.onBrand} />
      ) : (
        <Text style={[styles.label, variant === "ghost" && { color: theme.colors.text }]}>
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 52,
    borderRadius: theme.radius.lg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  glow: {
    shadowColor: theme.colors.brandLight,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 8,
  },
  label: {
    color: theme.colors.onBrand,
    fontSize: 16,
    fontFamily: theme.font.bodyBold,
  },
});
