import { View, StyleSheet, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { useEffect } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "../../theme/tokens";

export function Skeleton({
  height = 16,
  width = "100%" as number | `${number}%`,
  radius = theme.radius.sm,
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  radius?: number;
  style?: ViewStyle;
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      false
    );
  }, []);
  const shimmer = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(progress.value, [0, 1], [-80, 120]),
      },
    ],
    opacity: interpolate(progress.value, [0, 0.5, 1], [0.35, 0.7, 0.35]),
  }));
  return (
    <View
      style={[
        styles.base,
        { height, width: width as any, borderRadius: radius, overflow: "hidden" },
        style,
      ]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, shimmer]}>
        <LinearGradient
          colors={["transparent", "rgba(255,255,255,0.55)", "transparent"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

export function CreatorRowSkeleton() {
  return (
    <View style={styles.row}>
      <Skeleton height={64} width={64} radius={20} />
      <View style={{ flex: 1, gap: 8 }}>
        <Skeleton height={16} width="55%" />
        <Skeleton height={12} width="35%" />
        <Skeleton height={12} width="70%" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: theme.colors.surface },
  row: {
    flexDirection: "row",
    gap: 14,
    padding: 14,
    marginBottom: 10,
    backgroundColor: "#fff",
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
});
