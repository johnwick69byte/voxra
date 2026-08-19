import { Pressable, StyleSheet, ViewStyle } from "react-native";
import { ReactNode } from "react";
import { theme } from "../../theme/tokens";

/** Interaction-only card — used for tappable rows/packs, not decorative chrome. */
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
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.backgroundElevated,
    borderRadius: theme.radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  pressed: { opacity: 0.88, transform: [{ scale: 0.99 }] },
});
