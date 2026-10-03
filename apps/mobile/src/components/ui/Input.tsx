import { useState } from "react";
import { TextInput, StyleSheet, TextInputProps, View } from "react-native";
import { AppText } from "./Text";
import { theme } from "../../theme/tokens";

export function Input({
  label,
  style,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & { label?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? (
        <AppText variant="label" style={styles.label}>
          {label}
        </AppText>
      ) : null}
      <TextInput
        placeholderTextColor={theme.colors.textMuted}
        style={[styles.input, focused && styles.inputFocused, style]}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
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
  inputFocused: { borderColor: theme.colors.brandLight },
});
