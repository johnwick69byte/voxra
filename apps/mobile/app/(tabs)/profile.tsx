import { View, StyleSheet, Pressable, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthStore } from "../../src/store/authStore";
import { AppText, Avatar } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";
import { APP_NAME } from "../../src/theme/brand";

type RowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
};

function MenuRow({ icon, label, sub, onPress, danger, last }: RowProps) {
  return (
    <Pressable style={[styles.menuItem, last && styles.menuLast]} onPress={onPress}>
      <View style={[styles.menuIcon, danger && styles.menuIconDanger]}>
        <Ionicons name={icon} size={20} color={danger ? theme.colors.error : theme.colors.brandLight} />
      </View>
      <View style={{ flex: 1 }}>
        <AppText style={[styles.menuText, danger && { color: theme.colors.error }]}>{label}</AppText>
        {sub ? (
          <AppText variant="caption" style={{ marginTop: 2 }}>
            {sub}
          </AppText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const isCreator = user?.user_type === "creator";

  const confirmLogout = () => {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
      <AppText style={styles.brand}>{APP_NAME}</AppText>

      <View style={styles.profileCard}>
        <View style={styles.avatarRing}>
          <Avatar uri={user?.picture} name={user?.name || "You"} size={88} />
        </View>
        <AppText style={styles.name}>{user?.name || "User"}</AppText>
        <AppText variant="caption">@{user?.username || "—"}</AppText>
        <View style={[styles.badge, isCreator ? styles.badgeCreator : styles.badgeFan]}>
          <Ionicons
            name={isCreator ? "sparkles" : "person"}
            size={14}
            color={theme.colors.onBrand}
          />
          <AppText style={styles.badgeText}>{isCreator ? "Creator" : "Fan"}</AppText>
        </View>
      </View>

      {isCreator ? (
        <>
          <AppText variant="label" style={styles.sectionLabel}>Creator</AppText>
          <View style={styles.section}>
            <MenuRow icon="create" label="Edit profile" sub="Photos, bio, category & rates" onPress={() => router.push("/edit-profile")} />
            <MenuRow icon="pricetag" label="Call rates" sub="Audio & video per minute" onPress={() => router.push({ pathname: "/pricing-setup", params: { edit: "1" } })} />
            <MenuRow icon="stats-chart" label="Earnings" sub="Breakdown & commission" onPress={() => router.push("/earnings")} />
            <MenuRow icon="heart" label="Saved creators" onPress={() => router.push("/(tabs)/favorites")} last />
          </View>
        </>
      ) : null}

      <AppText variant="label" style={styles.sectionLabel}>General</AppText>
      <View style={styles.section}>
        {!isCreator ? (
          <MenuRow icon="create" label="Edit profile" onPress={() => router.push("/edit-profile")} />
        ) : null}
        <MenuRow icon="time" label="Call history" onPress={() => router.push("/call-history")} />
        <MenuRow icon="gift" label="Invite friends" onPress={() => router.push("/(tabs)/referral")} />
        <MenuRow icon="notifications" label="Notifications" onPress={() => router.push("/notifications")} />
        <MenuRow icon="help-circle" label="Help & support" onPress={() => router.push("/support")} />
        <MenuRow icon="shield-checkmark" label="Privacy policy" onPress={() => router.push("/privacy")} />
        <MenuRow icon="document-text" label="Terms of service" onPress={() => router.push("/terms")} last />
      </View>

      <Pressable style={styles.logout} onPress={confirmLogout}>
        <Ionicons name="log-out" size={20} color="#fff" />
        <AppText style={styles.logoutText}>Log out</AppText>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, paddingTop: 60, paddingHorizontal: 16 },
  brand: {
    fontFamily: theme.font.display,
    fontSize: 32,
    color: theme.colors.brand,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  profileCard: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: 28,
    paddingHorizontal: 20,
  },
  avatarRing: {
    padding: 4,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: theme.colors.brand,
    marginBottom: 14,
  },
  name: { fontFamily: theme.font.displayMedium, fontSize: 24, color: theme.colors.text, marginTop: 4 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
    marginTop: 12,
  },
  badgeFan: { backgroundColor: theme.colors.brand },
  badgeCreator: { backgroundColor: theme.colors.accentDeep },
  badgeText: { fontFamily: theme.font.bodyBold, color: theme.colors.onBrand, fontSize: 12 },
  sectionLabel: {
    marginTop: 24,
    marginBottom: 8,
    paddingHorizontal: 8,
  },
  section: {
    backgroundColor: theme.colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  menuLast: { borderBottomWidth: 0 },
  menuIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: "rgba(45,212,191,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  menuIconDanger: { backgroundColor: "rgba(239,68,68,0.12)" },
  menuText: { fontFamily: theme.font.bodySemi, fontSize: 16, color: theme.colors.text },
  logout: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: theme.colors.error,
    marginTop: 28,
    paddingVertical: 16,
    borderRadius: 16,
  },
  logoutText: { fontFamily: theme.font.bodyBold, color: "#fff", fontSize: 16 },
});
