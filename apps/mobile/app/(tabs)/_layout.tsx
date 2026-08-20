import { Pressable, StyleSheet, Platform } from "react-native";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { theme } from "../../src/theme/tokens";
import { useAuthStore } from "../../src/store/authStore";

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

export default function TabsLayout() {
  const userType = useAuthStore((s) => s.user?.user_type);
  const isCreator = userType === "creator";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brandLight,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.backgroundElevated,
          borderTopColor: theme.colors.border,
          borderTopWidth: 1,
          height: Platform.OS === "ios" ? 88 : 64,
          paddingTop: 6,
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
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBtn: { flex: 1, alignItems: "center", justifyContent: "center" },
});
