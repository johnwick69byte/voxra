import { Text as RNText, TextProps, StyleSheet } from "react-native";
import { theme } from "../../theme/tokens";

type Variant = "hero" | "title" | "subtitle" | "body" | "caption" | "label" | "brand";

export function AppText({
  variant = "body",
  color,
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: string }) {
  return (
    <RNText
      {...rest}
      style={[styles.base, styles[variant], color ? { color } : null, style]}
    />
  );
}

const styles = StyleSheet.create({
  base: { color: theme.colors.text },
  hero: {
    fontFamily: theme.font.display,
    fontSize: theme.font.size.hero,
    letterSpacing: -1.2,
    lineHeight: 48,
  },
  brand: {
    fontFamily: theme.font.display,
    fontSize: 36,
    color: theme.colors.brand,
    letterSpacing: -0.8,
  },
  title: {
    fontFamily: theme.font.displayMedium,
    fontSize: theme.font.size.xl,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontFamily: theme.font.body,
    fontSize: theme.font.size.md,
    color: theme.colors.textSecondary,
    lineHeight: 22,
  },
  body: {
    fontFamily: theme.font.body,
    fontSize: theme.font.size.md,
  },
  caption: {
    fontFamily: theme.font.body,
    fontSize: theme.font.size.sm,
    color: theme.colors.textSecondary,
  },
  label: {
    fontFamily: theme.font.bodySemi,
    fontSize: theme.font.size.xs,
    color: theme.colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
