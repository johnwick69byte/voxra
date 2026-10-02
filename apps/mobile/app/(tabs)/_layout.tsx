import { Pressable, StyleSheet, Platform } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { theme } from "../../src/theme/tokens";
import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../src/store/authStore";
import { creatorsAPI } from "../../src/services/api";
import { useNotificationsStore } from "../../src/store/notificationsStore";

function ScaleTabButton(props: any) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <Pressable
      {...props}
      onPressIn={() => {
        scale.value = withSpring(0.88, { damping: 14 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 12 });
      }}
      style={[styles.tabBtn, props.style]}
    >
      <Animated.View style={style}>{props.children}</Animated.View>
    </Pressable>
  );
}

const STEP_HREF: Record<string, string> = {
  complete_profile: "/(auth)/complete-profile",
  pricing_setup: "/pricing-setup",
  creator_photos: "/creator-photos",
  verification_selfie: "/verification-selfie",
  pending_approval: "/pending-approval",
};

export default function TabsLayout() {
  const router = useRouter();
  const userType = useAuthStore((s) => s.user?.user_type);
  const userId = useAuthStore((s) => s.user?.user_id);
  const unread = useNotificationsStore((s) => s.unread);
  const refreshUnread = useNotificationsStore((s) => s.refresh);
  const isCreator = userType === "creator";

  useEffect(() => {
    if (userId) refreshUnread();
  }, [userId, refreshUnread]);

  useEffect(() => {
    if (!isCreator || !userId) return;
    creatorsAPI.onboardingStatus().then((res) => {
      const step = res.data?.next_step;
      const href = step && STEP_HREF[step];
      if (href) router.replace(href as never);
    });
  }, [isCreator, userId]);
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 16 : 8);
  const tabBarHeight = 52 + bottomInset;

  return (
    <Tabs
      safeAreaInsets={{ bottom: 0 }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brandLight,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.backgroundElevated,
          borderTopColor: theme.colors.border,
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingTop: 6,
          paddingBottom: bottomInset,
        },
        tabBarLabelStyle: {
          fontFamily: theme.font.bodySemi,
          fontSize: 11,
        },
        tabBarButton: (props) => <ScaleTabButton {...props} />,
      }}
    >
      <Tabs.Screen
        name="browse"
        options={{
          title: isCreator ? "Home" : "Browse",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name={isCreator ? "home" : "compass"} size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="following"
        options={{
          title: isCreator ? "Calls" : "Following",
          href: isCreator ? null : undefined,
          tabBarIcon: ({ color, size }) => <Ionicons name="heart" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="referral"
        options={{
          title: "Refer",
          tabBarIcon: ({ color, size }) => <Ionicons name="gift" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color, size }) => <Ionicons name="wallet" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.colors.brand, fontSize: 10 },
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBtn: { flex: 1, alignItems: "center", justifyContent: "center" },
});
