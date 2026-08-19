import { View, StyleSheet, ViewStyle, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "../theme/tokens";
import { ReactNode } from "react";

export function Screen({
  children,
  style,
  scroll,
  padded = true,
}: {
  children: ReactNode;
  style?: ViewStyle;
  scroll?: boolean;
  padded?: boolean;
}) {
  const body = (
    <View style={[styles.inner, padded && styles.padded, style]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  inner: { flex: 1 },
  padded: { paddingHorizontal: theme.spacing.lg },
});
