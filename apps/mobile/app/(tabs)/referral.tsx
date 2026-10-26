import { useCallback, useState } from "react";
import {
  View,
  StyleSheet,
  ScrollView,
  Share,
  TextInput,
  RefreshControl,
  Clipboard,
  Pressable,
} from "react-native";
import { useFocusEffect } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import Toast from "react-native-toast-message";
import * as Haptics from "expo-haptics";
import { Screen, AppText } from "../../src/components/ui";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { referralAPI, modelReferralAPI } from "../../src/services/api";
import { useAuthStore } from "../../src/store/authStore";
import { theme } from "../../src/theme/tokens";
import { APP_NAME, APP_SCHEME } from "../../src/theme/brand";

type TabKey = "friends" | "creators";

export default function ReferralScreen() {
  const user = useAuthStore((s) => s.user);
  const isCreator = user?.user_type === "creator";

  const [tab, setTab] = useState<TabKey>("friends");
  const [data, setData] = useState<any>(null);
  const [modelData, setModelData] = useState<any>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [applyCode, setApplyCode] = useState("");
  const [modelApplyCode, setModelApplyCode] = useState("");
  const [applying, setApplying] = useState(false);
  const [modelApplying, setModelApplying] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await referralAPI.overview();
      setData(res.data);
      if (isCreator) {
        try {
          const modelRes = await modelReferralAPI.overview();
          setModelData(modelRes.data);
          setModelError(null);
        } catch (e: any) {
          // Model referral data is additive; never block the fan tab on it.
          setModelData(null);
          setModelError(
            e?.response?.data?.detail || "Could not load creator referrals"
          );
        }
      }
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Could not load referrals",
        text2: e?.response?.data?.detail || e.message,
      });
    } finally {
      setRefreshing(false);
    }
  }, [isCreator]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const referralCode = data?.code || "————";
  const modelReferralCode = modelData?.code || "————";
  const referralShareMsg = `Join ${APP_NAME} with my code ${referralCode} — instant calls with creators. ${
    data?.share_url || `${APP_SCHEME}://login?ref=${referralCode}`
  }`;
  const modelReferralShareMsg =
    modelData?.share_message ||
    `🌟 Join ${APP_NAME} as a Creator!\n\n` +
      `Enter my code: ${modelReferralCode}\n` +
      `🔗 ${modelData?.share_url || `${APP_SCHEME}://login?model_ref=${modelData?.code || ""}`}`;

  const copy = async (code: string) => {
    if (!code || code === "————") return;
    try {
      Clipboard.setString(code);
    } catch {
      await Share.share({ message: code });
    }
    await Haptics.selectionAsync().catch(() => {});
    Toast.show({ type: "success", text1: "Code copied" });
  };

  const share = async (message: string) => {
    try {
      await Share.share({ message });
    } catch {
      Toast.show({ type: "info", text1: "Share failed" });
    }
  };

  const apply = async (isModel: boolean) => {
    const code = (isModel ? modelApplyCode : applyCode).trim();
    if (!code) return;
    const setBusy = isModel ? setModelApplying : setApplying;
    setBusy(true);
    try {
      if (isModel) {
        await modelReferralAPI.apply(code);
        setModelApplyCode("");
      } else {
        await referralAPI.apply(code);
        setApplyCode("");
      }
      Toast.show({ type: "success", text1: "Code applied" });
      await load();
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Could not apply code",
        text2: e?.response?.data?.detail || e.message,
      });
    } finally {
      setBusy(false);
    }
  };

  const renderFriendsTab = () => (
    <>
      <Animated.View
        entering={FadeInDown.duration(theme.motion.sheetSpring)}
        style={[styles.hero, !isCreator && styles.heroTop]}
      >
        <AppText variant="label">Invite & earn</AppText>
        <AppText style={styles.title}>Bring friends to {APP_NAME}</AppText>
        <AppText variant="subtitle" style={{ marginTop: 8 }}>
          They join with your code. You get ₹{data?.referrer_bonus ?? 25} when they first
          recharge. They get ₹{data?.referee_bonus ?? 20}.
        </AppText>
      </Animated.View>

      <View style={styles.codeCard}>
        <AppText variant="label">Your code</AppText>
        <AppText style={styles.code}>{referralCode}</AppText>
        <View style={styles.row}>
          <PrimaryButton
            label="Copy"
            variant="ghost"
            onPress={() => copy(referralCode)}
            style={{ flex: 1 }}
          />
          <PrimaryButton label="Share" onPress={() => share(referralShareMsg)} style={{ flex: 1 }} />
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

      <AppText variant="label" style={styles.sectionLabel}>
        How it works
      </AppText>
      <View style={styles.steps}>
        {[
          "Share your code with a friend",
          "They sign up and enter your code",
          "You both earn on their first recharge",
        ].map((text, index) => (
          <View key={text} style={styles.stepCard}>
            <View style={styles.stepNum}>
              <AppText style={styles.stepNumText}>{index + 1}</AppText>
            </View>
            <AppText style={styles.stepText}>{text}</AppText>
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
            onPress={() => apply(false)}
            loading={applying}
            style={{ marginTop: 12, opacity: applyCode.trim() ? 1 : 0.5 }}
          />
        </View>
      ) : null}

      <AppText variant="label" style={styles.sectionLabel}>
        Friends
      </AppText>
      {(data?.referrals || []).length === 0 ? (
        <AppText variant="caption" style={styles.empty}>
          No invites yet — share your code to start.
        </AppText>
      ) : (
        (data?.referrals || []).map((r: any) => (
          <View key={r.user_id} style={styles.referralCard}>
            <View style={{ flex: 1 }}>
              <AppText style={styles.itemName}>{r.name}</AppText>
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
    </>
  );

  const renderCreatorsTab = () => (
    <>
      <Animated.View entering={FadeInDown.duration(theme.motion.sheetSpring)} style={styles.hero}>
        <AppText variant="label">Creator referral program</AppText>
        <AppText style={styles.title}>Invite creators, earn {modelData?.referrer_bonus_percentage ?? 5}%</AppText>
        <AppText variant="subtitle" style={{ marginTop: 8 }}>
          Invite other creators. Earn {modelData?.referrer_bonus_percentage ?? 5}% of every
          successful withdrawal they make.
        </AppText>
      </Animated.View>

      {modelData ? (
        <>
          <View style={styles.codeCard}>
            <AppText variant="label">Your creator code</AppText>
            <AppText style={styles.code}>{modelReferralCode}</AppText>
            <View style={styles.row}>
              <PrimaryButton
                label="Copy"
                variant="ghost"
                onPress={() => copy(modelReferralCode)}
                style={{ flex: 1 }}
              />
              <PrimaryButton
                label="Share"
                onPress={() => share(modelReferralShareMsg)}
                style={{ flex: 1 }}
              />
            </View>
          </View>

          {modelData?.is_approved === false ? (
            <View style={styles.lockedCard}>
              <AppText style={styles.itemName}>Code pending approval</AppText>
              <AppText variant="caption" style={{ marginTop: 6 }}>
                You can share your code now, but other creators can apply it only after
                your creator profile is approved.
              </AppText>
            </View>
          ) : null}

          <View style={styles.stats}>
            <View style={styles.stat}>
              <AppText style={styles.statN}>{modelData?.referred_count ?? 0}</AppText>
              <AppText variant="caption">Creators invited</AppText>
            </View>
            <View style={styles.stat}>
              <AppText style={styles.statN}>
                ₹{(modelData?.earned_total ?? 0).toFixed(0)}
              </AppText>
              <AppText variant="caption">Total earned</AppText>
            </View>
            <View style={styles.stat}>
              <AppText style={styles.statN}>
                ₹{(modelData?.this_month_earnings ?? 0).toFixed(0)}
              </AppText>
              <AppText variant="caption">This month</AppText>
            </View>
          </View>

          <AppText variant="label" style={styles.sectionLabel}>
            How it works
          </AppText>
          <View style={styles.steps}>
            {[
              "Share your creator code with another creator",
              "They sign up as Creator and enter your code",
              `You earn ${modelData?.referrer_bonus_percentage ?? 5}% of every withdrawal they make`,
            ].map((text, index) => (
              <View key={text} style={styles.stepCard}>
                <View style={styles.stepNum}>
                  <AppText style={styles.stepNumText}>{index + 1}</AppText>
                </View>
                <AppText style={styles.stepText}>{text}</AppText>
              </View>
            ))}
          </View>

          <AppText variant="label" style={styles.sectionLabel}>
            Referral earnings
          </AppText>
          <View style={styles.earningsCard}>
            <View style={styles.earningRow}>
              <View style={styles.earningItem}>
                <AppText variant="caption">This month</AppText>
                <AppText style={styles.earningAmount}>
                  ₹{(modelData?.this_month_earnings ?? 0).toFixed(0)}
                </AppText>
              </View>
              <View style={styles.earningItem}>
                <AppText variant="caption">Last 30 days</AppText>
                <AppText style={styles.earningAmount}>
                  ₹{(modelData?.last_30_days_earnings ?? 0).toFixed(0)}
                </AppText>
              </View>
              <View style={styles.earningItem}>
                <AppText variant="caption">All time</AppText>
                <AppText style={styles.earningAmount}>
                  ₹{(modelData?.earned_total ?? 0).toFixed(0)}
                </AppText>
              </View>
            </View>
          </View>

          <AppText variant="label" style={styles.sectionLabel}>
            Your creator referrals
          </AppText>
          {(modelData?.referrals || []).length === 0 ? (
            <AppText variant="caption" style={styles.empty}>
              No creator referrals yet — share your code to start earning.
            </AppText>
          ) : (
            (modelData?.referrals || []).map((r: any) => (
              <View key={r.user_id} style={styles.referralCard}>
                <View style={{ flex: 1 }}>
                  <AppText style={styles.itemName}>{r.name}</AppText>
                  <AppText variant="caption">{r.phone_masked}</AppText>
                  <AppText variant="caption" color={theme.colors.textMuted}>
                    Joined{" "}
                    {r.joined_at ? new Date(r.joined_at).toLocaleDateString() : "—"}
                  </AppText>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <View style={[styles.statusPill, r.status === "active" && styles.statusPillOn]}>
                    <AppText
                      variant="caption"
                      color={r.status === "active" ? theme.colors.success : theme.colors.accent}
                    >
                      {r.status === "active" ? "Earning" : "Pending"}
                    </AppText>
                  </View>
                  <AppText style={styles.itemEarned}>
                    ₹{(r.total_bonus_from_them ?? 0).toFixed(0)} earned
                  </AppText>
                  <AppText variant="caption" color={theme.colors.textMuted}>
                    ₹{(r.total_withdrawals ?? 0).toFixed(0)} withdrawn
                  </AppText>
                </View>
              </View>
            ))
          )}

          {(modelData?.earnings_history || []).length > 0 ? (
            <>
              <AppText variant="label" style={styles.sectionLabel}>
                Recent bonuses
              </AppText>
              {(modelData.earnings_history || []).slice(0, 10).map((row: any, index: number) => (
                <View
                  key={`${row.withdrawal_request_id || row.date || "bonus"}-${index}`}
                  style={styles.bonusRow}
                >
                  <View style={{ flex: 1 }}>
                    <AppText style={styles.itemName}>{row.referred_model}</AppText>
                    <AppText variant="caption">
                      On a ₹{Number(row.withdrawal_amount || 0).toFixed(0)} withdrawal
                      {row.date ? ` · ${new Date(row.date).toLocaleDateString()}` : ""}
                    </AppText>
                  </View>
                  <AppText style={styles.bonusAmount}>
                    +₹{Number(row.amount || 0).toFixed(2)}
                  </AppText>
                </View>
              ))}
            </>
          ) : null}

          {modelData?.can_apply ? (
            <View style={styles.apply}>
              <AppText variant="label">Were you referred by a creator?</AppText>
              <TextInput
                style={styles.input}
                placeholder="MDL123456"
                placeholderTextColor={theme.colors.textMuted}
                autoCapitalize="characters"
                value={modelApplyCode}
                onChangeText={setModelApplyCode}
              />
              <PrimaryButton
                label="Apply creator code"
                onPress={() => apply(true)}
                loading={modelApplying}
                style={{ marginTop: 12, opacity: modelApplyCode.trim() ? 1 : 0.5 }}
              />
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.lockedCard}>
          <AppText style={styles.itemName}>
            {modelError || "Creator referral code is being prepared"}
          </AppText>
          <AppText variant="caption" style={{ marginTop: 6 }}>
            {modelError
              ? "Pull down to retry."
              : "Once your creator profile is ready, your referral code and earnings appear here."}
          </AppText>
        </View>
      )}
    </>
  );

  return (
    <Screen ambient padded={false}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={load}
            tintColor={theme.colors.brandLight}
          />
        }
      >
        {isCreator ? (
          <View style={styles.tabs}>
            <Pressable
              onPress={() => setTab("friends")}
              style={[styles.tab, tab === "friends" && styles.tabOn]}
            >
              <AppText style={[styles.tabText, tab === "friends" && styles.tabTextOn]}>
                Invite friends
              </AppText>
            </Pressable>
            <Pressable
              onPress={() => setTab("creators")}
              style={[styles.tab, tab === "creators" && styles.tabOn]}
            >
              <AppText style={[styles.tabText, tab === "creators" && styles.tabTextOn]}>
                Creator referrals
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {isCreator && tab === "creators" ? renderCreatorsTab() : renderFriendsTab()}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    marginHorizontal: 24,
    marginTop: 56,
    padding: 4,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: theme.radius.md,
  },
  tabOn: { backgroundColor: theme.colors.brand },
  tabText: { fontFamily: theme.font.bodySemi, color: theme.colors.textMuted },
  tabTextOn: { color: theme.colors.onBrand },
  hero: { paddingTop: 24, paddingHorizontal: 24, paddingBottom: 12 },
  heroTop: { paddingTop: 56 },
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
    fontSize: 34,
    color: theme.colors.brandLight,
    letterSpacing: 3,
    marginVertical: 8,
  },
  row: { flexDirection: "row", gap: 10, marginTop: 8 },
  stats: { flexDirection: "row", marginHorizontal: 24, marginTop: 16, gap: 8 },
  stat: {
    flex: 1,
    backgroundColor: theme.colors.glass,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    alignItems: "center",
  },
  statN: { fontFamily: theme.font.display, fontSize: 22, color: theme.colors.text },
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
  itemName: { fontFamily: theme.font.bodyBold, color: theme.colors.text },
  itemEarned: {
    marginTop: 4,
    fontFamily: theme.font.bodyBold,
    color: theme.colors.accent,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(232,168,124,0.12)",
  },
  statusPillOn: { backgroundColor: "rgba(34,197,94,0.12)" },
  earningsCard: {
    marginHorizontal: 24,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
  },
  earningRow: { flexDirection: "row", gap: 8 },
  earningItem: { flex: 1, alignItems: "center" },
  earningAmount: {
    marginTop: 4,
    fontFamily: theme.font.display,
    fontSize: 20,
    color: theme.colors.text,
  },
  bonusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 24,
    marginTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  bonusAmount: {
    fontFamily: theme.font.bodyBold,
    color: theme.colors.success,
  },
  empty: { paddingHorizontal: 24, marginTop: 8 },
  lockedCard: {
    marginHorizontal: 24,
    marginTop: 16,
    padding: 18,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
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
