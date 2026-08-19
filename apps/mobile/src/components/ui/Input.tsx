import { TextInput, StyleSheet, TextInputProps, View } from "react-native";
import { AppText } from "./Text";
import { theme } from "../../theme/tokens";

export function Input({
  label,
  style,
  ...props
}: TextInputProps & { label?: string }) {
  return (
    <View style={styles.wrap}>
      {label ? <AppText variant="label" style={styles.label}>{label}</AppText> : null}
      <TextInput
        placeholderTextColor={theme.colors.textMuted}
        style={[styles.input, style]}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8 },
  label: { marginBottom: 6 },
  input: {
    backgroundColor: theme.colors.backgroundElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 16,
    height: 52,
    fontSize: 16,
    color: theme.colors.text,
    fontFamily: theme.font.body,
  },
});
