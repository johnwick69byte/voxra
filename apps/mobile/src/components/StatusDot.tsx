import { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { theme } from "../theme/tokens";

const colorMap: Record<string, string> = {
  ACTIVE: theme.colors.online,
  BUSY: theme.colors.busy,
  OFFLINE: theme.colors.offline,
  DND: theme.colors.dnd,
};

export function StatusDot({ status, label }: { status?: string; label?: boolean }) {
  const c = colorMap[status || "OFFLINE"] || theme.colors.offline;
  const progress = useSharedValue(1);
  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(1, { duration: theme.motion.statusFade });
  }, [status]);
  const anim = useAnimatedStyle(() => ({
    opacity: 0.55 + progress.value * 0.45,
    transform: [{ scale: 0.85 + progress.value * 0.15 }],
  }));
  return (
    <Animated.View entering={FadeIn.duration(theme.motion.statusFade)} style={styles.row}>
      <Animated.View style={[styles.dot, { backgroundColor: c }, anim]} />
      {label !== false && (
        <Text style={[styles.text, { color: c, fontFamily: theme.font.bodySemi }]}>
          {status || "OFFLINE"}
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontSize: 12, textTransform: "capitalize" },
});
