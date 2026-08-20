import { Pressable, StyleSheet, ViewStyle } from "react-native";
import { ReactNode } from "react";
import { theme } from "../../theme/tokens";

/** Glass card — tappable rows/packs on dark. */
export function Card({
  children,
  onPress,
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  if (!onPress) {
    return <Pressable style={[styles.card, style]}>{children}</Pressable>;
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        pressed && styles.pressed,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.glass,
    borderRadius: theme.radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pressed: { opacity: 0.9, transform: [{ scale: theme.motion.cardPress }] },
});
