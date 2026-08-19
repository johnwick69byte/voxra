import { View, Text, StyleSheet } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { theme } from "../theme/tokens";

const colorMap: Record<string, string> = {
  ACTIVE: theme.colors.online,
  BUSY: theme.colors.busy,
  OFFLINE: theme.colors.offline,
  DND: theme.colors.dnd,
};

export function StatusDot({ status, label }: { status?: string; label?: boolean }) {
  const c = colorMap[status || "OFFLINE"] || theme.colors.offline;
  return (
    <Animated.View entering={FadeIn.duration(theme.motion.statusFade)} style={styles.row}>
      <View style={[styles.dot, { backgroundColor: c }]} />
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
