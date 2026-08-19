import { View, StyleSheet, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useEffect } from "react";
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
  const opacity = useSharedValue(0.4);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);
  const anim = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        styles.base,
        { height, width: width as any, borderRadius: radius },
        anim,
        style,
      ]}
    />
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
