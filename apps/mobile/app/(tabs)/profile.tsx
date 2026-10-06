import { View, StyleSheet, Pressable, ScrollView, Alert, Modal, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { useAuthStore } from "../../src/store/authStore";
import { authAPI } from "../../src/services/api";
import { AppText, Avatar } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";
import { APP_NAME } from "../../src/theme/brand";
import Toast from "react-native-toast-message";

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

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

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

  const handleDeleteAccount = () => {
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (deleteConfirmText !== "DELETE") {
      Toast.show({
        type: "error",
        text1: "Invalid Confirmation",
        text2: 'Please type "DELETE" exactly to confirm',
      });
      return;
    }

    try {
      setDeletingAccount(true);
      const response = await authAPI.deleteAccount();
      if (response.data.success) {
        await logout();
        router.replace("/(auth)/login");
        Toast.show({
          type: "info",
          text1: "Account Deleted",
          text2: "Your account has been permanently deleted",
        });
      }
    } catch (error: any) {
      Toast.show({
        type: "error",
        text1: "Error",
        text2: error.response?.data?.detail || "Failed to delete account",
      });
    } finally {
      setDeletingAccount(false);
      setShowDeleteModal(false);
      setDeleteConfirmText("");
    }
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
            <MenuRow icon="stats-chart" label="Earnings" sub="Breakdown & commission" onPress={() => router.push("/earnings")} last />
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
        <MenuRow icon="document-text" label="Terms of service" onPress={() => router.push("/terms")} />
        <MenuRow
          icon="trash"
          label="Delete account"
          danger
          onPress={handleDeleteAccount}
          last
        />
      </View>

      <Pressable style={styles.logout} onPress={confirmLogout}>
        <Ionicons name="log-out" size={20} color="#fff" />
        <AppText style={styles.logoutText}>Log out</AppText>
      </Pressable>

      {/* Delete Account Modal */}
      <Modal visible={showDeleteModal} transparent animationType="slide" onRequestClose={() => setShowDeleteModal(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowDeleteModal(false)}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIconContainer}>
                <Ionicons name="alert-circle-outline" size={28} color={theme.colors.error} />
              </View>
              <AppText style={styles.modalTitle}>Delete Account</AppText>
            </View>
            <View style={styles.modalBody}>
              <AppText style={styles.modalWarning}>
                This action cannot be undone. All your data, including wallet balance, call history, and profile, will be permanently deleted and cannot be recovered.
              </AppText>
              <View style={styles.modalWarningBox}>
                <AppText style={styles.modalInfo}>
                  Type <AppText style={styles.deleteTextHighlight}>DELETE</AppText> to confirm:
                </AppText>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Type DELETE"
                  value={deleteConfirmText}
                  onChangeText={setDeleteConfirmText}
                  autoCapitalize="none"
                />
              </View>
            </View>
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalCancelButton} onPress={() => setShowDeleteModal(false)}>
                <AppText style={styles.modalCancelText}>Cancel</AppText>
              </Pressable>
              <Pressable
                style={[
                  styles.modalConfirmButton,
                  (deleteConfirmText !== "DELETE" || deletingAccount) && styles.modalConfirmButtonDisabled,
                ]}
                onPress={handleConfirmDelete}
                disabled={deleteConfirmText !== "DELETE" || deletingAccount}
              >
                <AppText style={styles.modalConfirmText}>
                  {deletingAccount ? "Deleting..." : "Delete Account"}
                </AppText>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: theme.colors.surface,
    borderRadius: 20,
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeader: {
    alignItems: "center",
    marginBottom: 16,
  },
  modalIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(239,68,68,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  modalTitle: {
    fontFamily: theme.font.displayMedium,
    fontSize: 22,
    color: theme.colors.text,
  },
  modalBody: {
    marginBottom: 20,
  },
  modalWarning: {
    fontFamily: theme.font.body,
    fontSize: 15,
    color: theme.colors.text,
    lineHeight: 22,
    marginBottom: 16,
  },
  modalWarningBox: {
    backgroundColor: "rgba(239,68,68,0.1)",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
  },
  modalInfo: {
    fontFamily: theme.font.body,
    fontSize: 14,
    color: theme.colors.textMuted,
    lineHeight: 20,
    marginBottom: 10,
  },
  deleteTextHighlight: {
    color: theme.colors.error,
    fontFamily: theme.font.bodyBold,
  },
  modalInput: {
    backgroundColor: theme.colors.background,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: theme.font.body,
    fontSize: 16,
    color: theme.colors.text,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
    marginTop: 20,
  },
  modalCancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  modalCancelText: {
    fontFamily: theme.font.bodyBold,
    fontSize: 16,
    color: theme.colors.text,
  },
  modalConfirmButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: theme.colors.error,
    alignItems: "center",
  },
  modalConfirmButtonDisabled: {
    opacity: 0.5,
  },
  modalConfirmText: {
    fontFamily: theme.font.bodyBold,
    fontSize: 16,
    color: "#fff",
  },
});
