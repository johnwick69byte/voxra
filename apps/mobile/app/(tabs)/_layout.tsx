import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../../src/theme/tokens";
import { useAuthStore } from "../../src/store/authStore";

export default function TabsLayout() {
  const userType = useAuthStore((s) => s.user?.user_type);
  const isCreator = userType === "creator";

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.brand,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: {
          backgroundColor: theme.colors.backgroundElevated,
          borderTopColor: theme.colors.border,
        },
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
