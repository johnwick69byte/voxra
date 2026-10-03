import { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Share,
  TextInput,
  RefreshControl,
  Clipboard,
} from "react-native";
import { useFocusEffect } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import Toast from "react-native-toast-message";
import * as Haptics from "expo-haptics";
import { Screen, AppText } from "../../src/components/ui";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { referralAPI } from "../../src/services/api";
import { theme } from "../../src/theme/tokens";
import { APP_NAME, APP_SCHEME } from "../../src/theme/brand";

export default function ReferralScreen() {
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [applyCode, setApplyCode] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const res = await referralAPI.overview();
      setData(res.data);
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Could not load referrals",
        text2: e?.response?.data?.detail || e.message,
      });
    } finally {
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const code = data?.code || "————";
  const shareMsg = `Join ${APP_NAME} with my code ${code} — instant calls with creators. ${data?.share_url || `${APP_SCHEME}://login?ref=${code}`}`;

  const copy = async () => {
    try {
      Clipboard.setString(code);
    } catch {
      await Share.share({ message: code });
    }
    await Haptics.selectionAsync().catch(() => {});
    Toast.show({ type: "success", text1: "Code copied" });
  };

  const share = async () => {
    try {
      await Share.share({ message: shareMsg });
    } catch {
      Toast.show({ type: "info", text1: code });
    }
  };

  const apply = async () => {
    if (!applyCode.trim()) return;
    setLoading(true);
    try {
      await referralAPI.apply(applyCode.trim());
      Toast.show({ type: "success", text1: "Code applied" });
      setApplyCode("");
      await load();
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Could not apply",
        text2: e?.response?.data?.detail || e.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen ambient padded={false}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} tintColor={theme.colors.brandLight} />}
      >
        <Animated.View entering={FadeInDown.duration(theme.motion.sheetSpring)} style={styles.hero}>
          <AppText variant="label">Invite & earn</AppText>
          <AppText style={styles.title}>Bring friends to {APP_NAME}</AppText>
          <AppText variant="subtitle" style={{ marginTop: 8 }}>
            They join with your code. You get ₹{data?.referrer_bonus ?? 25} when they first recharge.
            They get ₹{data?.referee_bonus ?? 20}.
          </AppText>
        </Animated.View>

        <View style={styles.codeCard}>
          <AppText variant="label">Your code</AppText>
          <AppText style={styles.code}>{code}</AppText>
          <View style={styles.row}>
            <PrimaryButton label="Copy" variant="ghost" onPress={copy} style={{ flex: 1 }} />
            <PrimaryButton label="Share" onPress={share} style={{ flex: 1 }} />
          </View>
        </View>

        <View style={styles.stats}>
          <View style={styles.stat}>
            <AppText style={styles.statN}>{data?.referred_count ?? 0}</AppText>
            <AppText variant="caption">Invited</AppText>
          </View>
          <View style={styles.stat}>
            <AppText style={styles.statN}>₹{(data?.earned_total ?? 0).toFixed(0)}</AppText>
            <AppText variant="caption">Earned</AppText>
          </View>
          <View style={styles.stat}>
            <AppText style={styles.statN}>{data?.pending_count ?? 0}</AppText>
            <AppText variant="caption">Pending</AppText>
          </View>
        </View>

        <AppText variant="label" style={styles.sectionLabel}>How it works</AppText>
        <View style={styles.steps}>
          {[
            "Share your code with a friend",
            "Friend signs up and enters your code",
            "You both earn on their first recharge",
          ].map((t, i) => (
            <View key={t} style={styles.stepCard}>
              <View style={styles.stepNum}>
                <AppText style={styles.stepNumText}>{i + 1}</AppText>
              </View>
              <AppText style={styles.stepText}>{t}</AppText>
            </View>
          ))}
        </View>

        {data?.can_apply ? (
          <View style={styles.apply}>
            <AppText variant="label">Have a friend's code?</AppText>
            <TextInput
              style={styles.input}
              placeholder="ABCD1234"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="characters"
              value={applyCode}
              onChangeText={setApplyCode}
            />
            <PrimaryButton
              label="Apply code"
              onPress={apply}
              loading={loading}
              style={{ marginTop: 12, opacity: applyCode.trim() ? 1 : 0.5 }}
            />
          </View>
        ) : null}

        <AppText variant="label" style={styles.sectionLabel}>
          Friends
        </AppText>
        {(data?.referrals || []).length === 0 ? (
          <AppText variant="caption" style={{ paddingHorizontal: 24, marginTop: 8 }}>
            No invites yet — share your code to start.
          </AppText>
        ) : (
          (data.referrals || []).map((r: any) => (
            <View key={r.user_id} style={styles.referralCard}>
              <View style={{ flex: 1 }}>
                <AppText style={{ fontFamily: theme.font.bodyBold }}>{r.name}</AppText>
                <AppText variant="caption">{r.phone_masked}</AppText>
              </View>
              <View style={[styles.statusPill, r.status === "rewarded" && styles.statusPillOn]}>
                <AppText
                  variant="caption"
                  color={r.status === "rewarded" ? theme.colors.success : theme.colors.accent}
                >
                  {r.status === "rewarded" ? "Rewarded" : "Joined"}
                </AppText>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { paddingTop: 56, paddingHorizontal: 24, paddingBottom: 12 },
  title: {
    fontFamily: theme.font.display,
    fontSize: 32,
    color: theme.colors.text,
    marginTop: 8,
    letterSpacing: -0.6,
  },
  codeCard: {
    marginHorizontal: 24,
    padding: 20,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  code: {
    fontFamily: theme.font.display,
    fontSize: 36,
    color: theme.colors.brandLight,
    letterSpacing: 3,
    marginVertical: 8,
  },
  row: { flexDirection: "row", gap: 10, marginTop: 8 },
  stats: {
    flexDirection: "row",
    marginHorizontal: 24,
    marginTop: 16,
    gap: 8,
  },
  stat: {
    flex: 1,
    backgroundColor: theme.colors.glass,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    alignItems: "center",
  },
  statN: {
    fontFamily: theme.font.display,
    fontSize: 22,
    color: theme.colors.text,
  },
  steps: { marginHorizontal: 24, marginTop: 4, gap: 8 },
  stepCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
  },
  stepNum: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: theme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumText: { fontFamily: theme.font.bodyBold, color: theme.colors.onBrand },
  stepText: { flex: 1, fontFamily: theme.font.bodySemi, color: theme.colors.text },
  sectionLabel: { paddingHorizontal: 24, marginTop: 20, marginBottom: 8 },
  referralCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 24,
    marginTop: 8,
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(232,168,124,0.12)",
  },
  statusPillOn: { backgroundColor: "rgba(34,197,94,0.12)" },
  apply: { marginHorizontal: 24, marginTop: 20 },
  input: {
    marginTop: 8,
    height: 52,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    paddingHorizontal: 14,
    color: theme.colors.text,
    fontFamily: theme.font.body,
  },
});
