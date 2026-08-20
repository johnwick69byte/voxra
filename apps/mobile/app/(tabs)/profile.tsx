import { View, StyleSheet, Pressable, ScrollView, Share } from "react-native";
import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import { useAuthStore } from "../../src/store/authStore";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { AppText, Avatar } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";

export default function ProfileScreen() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const isCreator = user?.user_type === "creator";

  const shareReferral = async () => {
    if (!user?.referral_code) return;
    try {
      await Share.share({
        message: `Join Voxora with my code ${user.referral_code} — instant calls with creators.`,
      });
    } catch {
      Toast.show({ type: "info", text1: user.referral_code });
    }
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 40 }}>
      <AppText style={styles.brand}>Voxora</AppText>
      <View style={styles.heroRow}>
        <Avatar uri={user?.picture} name={user?.name || "You"} size={72} />
        <View style={{ flex: 1 }}>
          <AppText style={styles.name}>{user?.name || "User"}</AppText>
          <AppText variant="caption">
            @{user?.username || "—"} · {user?.user_type}
          </AppText>
        </View>
      </View>

      {user?.referral_code ? (
        <Pressable style={styles.refCard} onPress={shareReferral}>
          <AppText variant="label" style={{ color: "rgba(255,255,255,0.7)" }}>
            Your referral code
          </AppText>
          <AppText style={styles.refCode}>{user.referral_code}</AppText>
          <AppText variant="caption" style={{ color: "rgba(255,255,255,0.7)" }}>
            Tap to share — earn when friends recharge
          </AppText>
        </Pressable>
      ) : null}

      <View style={styles.links}>
        <Pressable onPress={() => router.push("/edit-profile")}>
          <AppText style={styles.link}>Edit profile</AppText>
        </Pressable>
        {isCreator && (
          <Pressable onPress={() => router.push("/pricing-setup")}>
            <AppText style={styles.link}>Call rates</AppText>
          </Pressable>
        )}
        <Pressable onPress={() => router.push("/call-history")}>
          <AppText style={styles.link}>Call history</AppText>
        </Pressable>
        <Pressable onPress={() => router.push("/notifications")}>
          <AppText style={styles.link}>Notifications</AppText>
        </Pressable>
        <Pressable onPress={() => router.push("/privacy")}>
          <AppText style={styles.link}>Privacy policy</AppText>
        </Pressable>
        <Pressable onPress={() => router.push("/terms")}>
          <AppText style={styles.link}>Terms of service</AppText>
        </Pressable>
      </View>
      <PrimaryButton
        label="Log out"
        variant="ghost"
        onPress={async () => {
          await logout();
          router.replace("/(auth)/login");
        }}
        style={{ marginTop: 24 }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: theme.colors.background,
    paddingTop: 64,
    paddingHorizontal: 24,
  },
  brand: {
    fontFamily: theme.font.display,
    fontSize: 32,
    color: theme.colors.brand,
  },
  heroRow: {
    flexDirection: "row",
    gap: 16,
    alignItems: "center",
    marginTop: 20,
  },
  name: {
    fontFamily: theme.font.displayMedium,
    fontSize: 24,
    color: theme.colors.text,
  },
  refCard: {
    marginTop: 24,
    backgroundColor: theme.colors.brandDark,
    borderRadius: theme.radius.lg,
    padding: 18,
  },
  refCode: {
    fontFamily: theme.font.display,
    fontSize: 28,
    color: "#fff",
    marginTop: 6,
    letterSpacing: 2,
  },
  links: { marginTop: 32, gap: 16 },
  link: {
    fontSize: 17,
    fontFamily: theme.font.bodySemi,
    color: theme.colors.text,
  },
});
