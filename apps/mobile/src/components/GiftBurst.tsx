import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { theme } from "../theme/tokens";

export type GiftFx = {
  id: string;
  amount: number;
  direction: "sent" | "received";
};

export function GiftBurst({
  gift,
  onDone,
}: {
  gift: GiftFx;
  onDone: (id: string) => void;
}) {
  const y = useSharedValue(gift.direction === "sent" ? 120 : -80);
  const x = useSharedValue(gift.direction === "sent" ? -40 : 40);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.4);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    opacity.value = withTiming(1, { duration: 180 });
    scale.value = withSpring(1.15, { damping: 10 });
    y.value = withSequence(
      withTiming(gift.direction === "sent" ? -80 : 40, { duration: 900 }),
      withDelay(200, withTiming(gift.direction === "sent" ? -140 : 90, { duration: 400 }))
    );
    x.value = withTiming(0, { duration: 900 });
    opacity.value = withDelay(
      1100,
      withTiming(0, { duration: 280 }, (finished) => {
        if (finished) runOnJS(onDone)(gift.id);
      })
    );
  }, [gift.id]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }, { translateX: x.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        gift.direction === "sent" ? styles.bottom : styles.top,
        style,
      ]}
    >
      <View style={styles.pill}>
        <Text style={styles.emoji}>{gift.direction === "sent" ? "🎁" : "✨"}</Text>
        <Text style={styles.amt}>
          {gift.direction === "sent" ? "Sent" : "Got"} ₹{gift.amount}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 50,
  },
  top: { top: 140 },
  bottom: { bottom: 160 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(15,118,110,0.92)",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(232,168,124,0.5)",
  },
  emoji: { fontSize: 22 },
  amt: {
    color: "#fff",
    fontFamily: theme.font.bodyBold,
    fontSize: 16,
  },
});
