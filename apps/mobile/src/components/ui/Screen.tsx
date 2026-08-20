import { ReactNode } from "react";
import { View, StyleSheet, ViewStyle, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useEffect } from "react";
import { theme } from "../../theme/tokens";

function AmbientOrbs() {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: theme.motion.glowPulse, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);
  const a = useAnimatedStyle(() => ({
    transform: [{ translateY: t.value * 12 }, { scale: 1 + t.value * 0.06 }],
    opacity: 0.22 + t.value * 0.1,
  }));
  const b = useAnimatedStyle(() => ({
    transform: [{ translateY: -t.value * 10 }, { scale: 1.05 - t.value * 0.05 }],
    opacity: 0.16 + (1 - t.value) * 0.08,
  }));
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.orbTeal, a]} />
      <Animated.View style={[styles.orbCopper, b]} />
    </View>
  );
}

export function Screen({
  children,
  style,
  scroll,
  padded = true,
  ambient = false,
}: {
  children: ReactNode;
  style?: ViewStyle;
  scroll?: boolean;
  padded?: boolean;
  ambient?: boolean;
}) {
  const body = (
    <View style={[styles.inner, padded && styles.padded, style]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      {ambient ? <AmbientOrbs /> : null}
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
  orbTeal: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: theme.colors.brandLight,
    top: -40,
    right: -60,
  },
  orbCopper: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: theme.colors.accent,
    bottom: 80,
    left: -70,
  },
});
