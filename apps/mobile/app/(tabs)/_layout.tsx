import { StyleSheet, Platform, View, ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect } from "react";
import { useRouter } from "expo-router";
import { useAuthStore } from "../../src/store/authStore";
import { creatorsAPI } from "../../src/services/api";
import { useNotificationsStore } from "../../src/store/notificationsStore";
import { theme } from "../../src/theme/tokens";

function TabIcon({
  name,
  color,
  focused,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: ColorValue;
  focused: boolean;
}) {
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapOn]}>
      <Ionicons name={name} size={22} color={color as string} />
    </View>
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
  const tabBarHeight = 64 + bottomInset;

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
          paddingTop: 8,
          paddingBottom: bottomInset,
          paddingHorizontal: 6,
        },
        tabBarLabelStyle: {
          fontFamily: theme.font.bodySemi,
          fontSize: 11,
          marginTop: 2,
        },
        tabBarItemStyle: { paddingVertical: 2 },
      }}
    >
      <Tabs.Screen
        name="browse"
        options={{
          title: isCreator ? "Home" : "Browse",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name={isCreator ? "home" : "compass"} color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: isCreator ? "Saved" : "Favorites",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="heart" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="following"
        options={{
          title: isCreator ? "Calls" : "Following",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="people" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="referral"
        options={{
          title: "Refer",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="gift" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="wallet" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.colors.brand, fontSize: 10 },
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="person" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 48,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapOn: { backgroundColor: "rgba(45,212,191,0.14)" },
});
