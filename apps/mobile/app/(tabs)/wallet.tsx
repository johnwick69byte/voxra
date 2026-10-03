import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LinkingExpo from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import Toast from "react-native-toast-message";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { walletAPI } from "../../src/services/api";
import { useAuthStore } from "../../src/store/authStore";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { AppText } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";
import { APP_SCHEME } from "../../src/theme/brand";
import * as Haptics from "expo-haptics";

const PENDING_ORDER_KEY = "pending_recharge_order";
const TX_FILTERS = ["ALL", "RECHARGE", "CALL", "GIFT", "WITHDRAW"] as const;

export default function WalletScreen() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const isCreator = user?.user_type === "creator";
  const [balance, setBalance] = useState(0);
  const [earnings, setEarnings] = useState(0);
  const [txs, setTxs] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [successFlash, setSuccessFlash] = useState(false);
  const [txFilter, setTxFilter] = useState<(typeof TX_FILTERS)[number]>("ALL");
  const scale = useSharedValue(1);
  const prevBalance = useRef(0);

  const balAnim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const filteredTxs = useMemo(() => {
    if (txFilter === "ALL") return txs;
    return txs.filter((t) => String(t.type || "").toUpperCase().includes(txFilter));
  }, [txs, txFilter]);

  const celebrateCredit = async (next: number) => {
    if (prevBalance.current > 0 && next > prevBalance.current) {
      setSuccessFlash(true);
      scale.value = withSequence(
        withTiming(1.06, { duration: theme.motion.rechargeSuccess / 2 }),
        withTiming(1, { duration: theme.motion.rechargeSuccess / 2 })
      );
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setTimeout(() => setSuccessFlash(false), 1600);
    }
    prevBalance.current = next;
  };

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [b, t] = await Promise.all([walletAPI.balance(), walletAPI.transactions()]);
      const next = b.data.balance || 0;
      await celebrateCredit(next);
      setBalance(next);
      setEarnings(b.data.earnings_balance || 0);
      setTxs(t.data.transactions || []);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const verifyPending = useCallback(async () => {
    const orderId = await AsyncStorage.getItem(PENDING_ORDER_KEY);
    try {
      const res = await walletAPI.verifyPending(orderId || undefined);
      if (orderId) await AsyncStorage.removeItem(PENDING_ORDER_KEY);
      const credited = Number(res.data?.credited || 0);
      if (res.data?.status === "SUCCESS" || res.data?.recovered_count > 0 || credited > 0) {
        Toast.show({
          type: "success",
          text1: "Payment credited",
          text2: credited > 0 ? `₹${credited.toFixed(2)} added` : undefined,
        });
        await load();
      } else if (res.data?.status === "FAILED") {
        Toast.show({ type: "error", text1: "Payment failed" });
      }
    } catch {
      /* retry on next open */
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
      verifyPending();
    }, [load, verifyPending])
  );

  // Deep-link return (custom scheme) — settle and refresh.
  useEffect(() => {
    const sub = LinkingExpo.addEventListener("url", ({ url }) => {
      if (url?.includes("wallet")) {
        verifyPending();
        load();
      }
    });
    LinkingExpo.getInitialURL().then((url) => {
      if (url?.includes("wallet")) verifyPending();
    });
    return () => sub.remove();
  }, [load, verifyPending]);

  const recharge = async (amount?: number, packageId?: string) => {
    setCheckoutBusy(true);
    try {
      // Open the backend-rendered recharge page (balance + packs + custom amount),
      // which then starts Cashfree. This mirrors the old app's flow.
      const base = (process.env.EXPO_PUBLIC_API_URL || "").replace(/\/api$/, "");
      const token = useAuthStore.getState().token;
      const url = `${base}/api/wallet/recharge?token=${encodeURIComponent(token || "")}`;
      const result = await WebBrowser.openAuthSessionAsync(url, `${APP_SCHEME}://wallet`);
      await verifyPending();
      if (result.type === "cancel" || result.type === "dismiss") {
        Toast.show({ type: "info", text1: "Payment not completed" });
      }
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Recharge failed",
        text2: e?.response?.data?.detail || e.message,
      });
    } finally {
      setCheckoutBusy(false);
    }
  };

  const Header = (
    <View>
      <Animated.View entering={FadeInDown.duration(380)}>
        <Animated.View style={[styles.balanceCard, balAnim]}>
          <AppText style={styles.balLabel}>
            {successFlash ? "Balance updated" : "Spendable (calls & gifts)"}
          </AppText>
          <AppText style={styles.bal}>₹{balance.toFixed(2)}</AppText>
        </Animated.View>
      </Animated.View>

      {isCreator ? (
        <Animated.View entering={FadeInDown.delay(80).duration(380)} style={styles.earnCard}>
          <AppText style={styles.earnLabel}>Creator earnings</AppText>
          <AppText style={styles.earnBal}>₹{earnings.toFixed(2)}</AppText>
          <AppText style={styles.commissionHint}>
            85% of calls & gifts after the 15% platform fee
          </AppText>
          <PrimaryButton
            label="Withdraw to bank / UPI"
            onPress={() => router.push("/withdraw")}
            style={{ marginTop: 14 }}
          />
        </Animated.View>
      ) : earnings > 0 ? (
        <AppText variant="caption" style={{ paddingHorizontal: 24, marginTop: 4 }}>
          Referral / misc earnings: ₹{earnings.toFixed(2)}
        </AppText>
      ) : null}

      <AppText variant="label" style={styles.section}>
        Add money
      </AppText>
      <View style={styles.rechargeCard}>
        <View style={{ flex: 1 }}>
          <AppText style={styles.rechargeTitle}>Recharge wallet</AppText>
          <AppText variant="caption" style={{ marginTop: 2 }}>
            Securely via Cashfree. 94% is added to your balance.
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={22} color={theme.colors.textMuted} />
      </View>
      <PrimaryButton
        label="Recharge wallet"
        onPress={() => recharge()}
        loading={checkoutBusy}
        style={{ marginHorizontal: 24, marginTop: 12 }}
      />

      <PrimaryButton
        label="Verify pending payment"
        onPress={verifyPending}
        variant="ghost"
        style={{ marginHorizontal: 24, marginTop: 10 }}
      />

      <AppText variant="label" style={styles.section}>
        Ledger
      </AppText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
      >
        {TX_FILTERS.map((f) => (
          <Pressable
            key={f}
            onPress={() => setTxFilter(f)}
            style={[styles.chip, txFilter === f && styles.chipOn]}
          >
            <AppText style={[styles.chipText, txFilter === f && styles.chipTextOn]}>{f}</AppText>
          </Pressable>
        ))}
      </ScrollView>
      <View style={{ height: 8 }} />
    </View>
  );

  return (
    <View style={styles.wrap}>
      <FlatList
        data={filteredTxs}
        keyExtractor={(i) => i.transaction_id}
        ListHeaderComponent={Header}
        stickyHeaderIndices={[]}
        style={{ flex: 1 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={load} tintColor={theme.colors.brandLight} />
        }
        contentContainerStyle={{ paddingBottom: 40, paddingTop: 56 }}
        ListEmptyComponent={
          <AppText variant="caption" style={{ textAlign: "center", marginTop: 24 }}>
            No transactions yet.
          </AppText>
        }
        renderItem={({ item }) => (
          <View style={styles.tx}>
            <View style={styles.txRow}>
              <AppText style={styles.txType}>{String(item.type || "").replace(/_/g, " ")}</AppText>
              <AppText style={styles.txAmt}>₹{Number(item.amount).toFixed(2)}</AppText>
            </View>
            {item.description ? (
              <AppText variant="caption" style={{ marginTop: 2 }}>
                {item.description}
              </AppText>
            ) : null}
            {item.created_at ? (
              <AppText variant="caption" style={{ marginTop: 4 }}>
                {new Date(item.created_at).toLocaleDateString()}
              </AppText>
            ) : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  balanceCard: {
    marginHorizontal: 24,
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: theme.colors.brandDark,
    borderRadius: theme.radius.xl,
    padding: 24,
  },
  balLabel: { color: "rgba(243,239,232,0.7)", fontFamily: theme.font.bodySemi },
  bal: { color: theme.colors.onBrand, fontSize: 40, fontFamily: theme.font.display, marginTop: 4 },
  earnCard: {
    marginHorizontal: 24,
    marginBottom: 8,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(232,168,124,0.35)",
  },
  earnLabel: { color: theme.colors.accent, fontFamily: theme.font.bodySemi },
  earnBal: { color: theme.colors.onBrand, fontSize: 32, fontFamily: theme.font.display, marginTop: 4 },
  commissionHint: {
    color: "rgba(243,239,232,0.6)",
    marginTop: 6,
    fontFamily: theme.font.body,
    fontSize: 12,
  },
  section: { paddingHorizontal: 24, marginTop: 18, marginBottom: 10 },
  rechargeCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 24,
    padding: 18,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rechargeTitle: { fontFamily: theme.font.bodyBold, fontSize: 17, color: theme.colors.text },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  chipText: { fontFamily: theme.font.bodySemi, fontSize: 12, color: theme.colors.textSecondary },
  chipTextOn: { color: theme.colors.onBrand },
  tx: {
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    marginBottom: 8,
    marginHorizontal: 16,
  },
  txRow: { flexDirection: "row", justifyContent: "space-between" },
  txType: { fontFamily: theme.font.bodySemi, color: theme.colors.text, textTransform: "capitalize" },
  txAmt: { color: theme.colors.brandLight, fontFamily: theme.font.bodyBold },
});
