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

function getGiftIcon(amount: number, direction: "sent" | "received"): string {
  if (direction === "sent") {
    if (amount >= 100) return "💎";
    if (amount >= 50) return "💎";
    if (amount >= 25) return "🌹";
    return "🎁";
  }
  if (amount >= 100) return "💎";
  if (amount >= 50) return "💎";
  if (amount >= 25) return "🌹";
  return "✨";
}

function getGiftColor(amount: number): string {
  if (amount >= 100) return "#FFD700";
  if (amount >= 50) return "#E8A87C";
  if (amount >= 25) return "#EC4899";
  return "#2DD4BF";
}

function GiftBurst({
  gift,
  onDone,
}: {
  gift: GiftFx;
  onDone: (id: string) => void;
}) {
  const y = useSharedValue(gift.direction === "sent" ? 120 : -80);
  const x = useSharedValue(gift.direction === "sent" ? -40 : 40);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.3);
  const rotation = useSharedValue(0);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

    // Initial pop-in
    opacity.value = withTiming(1, { duration: 150 });
    scale.value = withSpring(1.2, { damping: 8, stiffness: 120 });

    // Float up/down
    y.value = withSequence(
      withTiming(gift.direction === "sent" ? -80 : 40, { duration: 800 }),
      withDelay(150, withTiming(gift.direction === "sent" ? -140 : 100, { duration: 400 }))
    );

    // Slight horizontal drift
    x.value = withSequence(
      withTiming(gift.direction === "sent" ? -30 : 30, { duration: 600 }),
      withTiming(0, { duration: 300 })
    );

    // Gentle rotation
    rotation.value = withSequence(
      withSpring(gift.direction === "sent" ? -15 : 15, { damping: 8, stiffness: 80 }),
      withDelay(300, withSpring(0, { damping: 10, stiffness: 60 }))
    );

    // Scale pulse
    scale.value = withSequence(
      withSpring(1.2, { damping: 8, stiffness: 120 }),
      withDelay(100, withSpring(1.0, { damping: 12, stiffness: 100 })),
      withDelay(500, withSpring(1.1, { damping: 10, stiffness: 80 })),
      withDelay(800, withSpring(1.0, { damping: 12, stiffness: 100 }))
    );

    // Fade out
    opacity.value = withDelay(
      1200,
      withTiming(0, { duration: 300 }, (finished) => {
        if (finished) runOnJS(onDone)(gift.id);
      })
    );
  }, [gift.id]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: y.value },
      { translateX: x.value },
      { scale: scale.value },
      { rotate: `${rotation.value}deg` },
    ],
    opacity: opacity.value,
  }));

  const giftColor = getGiftColor(gift.amount);
  const giftIcon = getGiftIcon(gift.amount, gift.direction);

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
        <Animated.View
          style={[
            styles.iconBg,
            { backgroundColor: `${giftColor}33` },
            { transform: [{ scale }] },
          ]}
        >
          <Text style={[{ color: giftColor }, styles.emoji]}>{giftIcon}</Text>
        </Animated.View>
        <View style={styles.textContainer}>
          <Text style={[{ color: giftColor }, styles.amt]}>
            {gift.direction === "sent" ? "Sent" : "Got"} \u20B9{gift.amount}
          </Text>
          <Text style={styles.subText}>You earned \u20B9{Math.round((gift.amount * 0.85))}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

export { GiftBurst, getGiftIcon, getGiftColor };

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
    gap: 10,
    backgroundColor: "rgba(15,118,110,0.95)",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(232,168,124,0.5)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  iconBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 22 },
  textContainer: { flex: 1 },
  amt: { fontFamily: theme.font.bodyBold, fontSize: 17, color: "#fff" },
  subText: {
    fontFamily: theme.font.body,
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    marginTop: 2,
  },
});