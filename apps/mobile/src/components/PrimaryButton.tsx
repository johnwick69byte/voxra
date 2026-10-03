import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from "react-native";
import { theme } from "../theme/tokens";

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  variant = "primary",
  style,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  style?: ViewStyle;
}) {
  const bg =
    variant === "danger"
      ? theme.colors.callRed
      : variant === "ghost"
        ? theme.colors.backgroundElevated
        : theme.colors.brand;
  const isDisabled = loading || disabled;
  return (
    <TouchableOpacity
      style={[
        styles.btn,
        variant === "primary" && styles.glow,
        {
          backgroundColor: bg,
          borderWidth: 1,
          borderColor:
            variant === "ghost"
              ? "rgba(255,255,255,0.14)"
              : variant === "danger"
                ? "rgba(255,255,255,0.12)"
                : theme.colors.brandLight,
          opacity: isDisabled && !loading ? 0.5 : 1,
        },
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={variant === "ghost" ? theme.colors.brandLight : "#fff"} />
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
    elevation: 6,
  },
  label: {
    color: "#fff",
    fontSize: 16,
    fontFamily: theme.font.bodyBold,
  },
});
