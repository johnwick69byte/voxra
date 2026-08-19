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
        <ActivityIndicator color={variant === "ghost" ? theme.colors.brand : "#fff"} />
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
  label: {
    color: "#fff",
    fontSize: 16,
    fontFamily: theme.font.bodyBold,
  },
});
