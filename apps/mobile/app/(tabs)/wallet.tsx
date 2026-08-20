import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  Linking,
  RefreshControl,
  TextInput,
  ScrollView,
} from "react-native";
import { useFocusEffect } from "expo-router";
import * as LinkingExpo from "expo-linking";
import Toast from "react-native-toast-message";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { walletAPI } from "../../src/services/api";
import { useAuthStore } from "../../src/store/authStore";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { AppText, Card } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";
import * as Haptics from "expo-haptics";

const PENDING_ORDER_KEY = "pending_recharge_order";
const LAST_RATE_KEY = "last_viewed_audio_rate";
const TX_FILTERS = ["ALL", "RECHARGE", "CALL", "GIFT", "WITHDRAW"] as const;

export default function WalletScreen() {
  const user = useAuthStore((s) => s.user);
  const isCreator = user?.user_type === "creator";
  const [balance, setBalance] = useState(0);
  const [earnings, setEarnings] = useState(0);
  const [packages, setPackages] = useState<any[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [lastRate, setLastRate] = useState<number | null>(null);
  const [successFlash, setSuccessFlash] = useState(false);
  const [txFilter, setTxFilter] = useState<(typeof TX_FILTERS)[number]>("ALL");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [upi, setUpi] = useState("");
  const scale = useSharedValue(1);
  const prevBalance = useRef(0);

  const balAnim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const filteredTxs = useMemo(() => {
    if (txFilter === "ALL") return txs;
    return txs.filter((t) => String(t.type || "").toUpperCase().includes(txFilter));
  }, [txs, txFilter]);

  const load = async () => {
    setRefreshing(true);
    try {
      const [b, p, t] = await Promise.all([
        walletAPI.balance(),
        walletAPI.packages(),
        walletAPI.transactions(),
      ]);
      const next = b.data.balance || 0;
      if (prevBalance.current > 0 && next > prevBalance.current) {
        setSuccessFlash(true);
        scale.value = withSequence(
          withTiming(1.06, { duration: theme.motion.rechargeSuccess / 2 }),
          withTiming(1, { duration: theme.motion.rechargeSuccess / 2 })
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => setSuccessFlash(false), 1600);
      }
      prevBalance.current = next;
      setBalance(next);
      setEarnings(b.data.earnings_balance || 0);
      setPackages(p.data.packages || []);
      setTxs(t.data.transactions || []);
    } finally {
      setRefreshing(false);
    }
  };

  const verifyPending = async () => {
    const orderId = await AsyncStorage.getItem(PENDING_ORDER_KEY);
    if (!orderId) return;
    try {
      const res = await walletAPI.verifyPending(orderId);
      if (res.data?.success) {
        await AsyncStorage.removeItem(PENDING_ORDER_KEY);
        Toast.show({ type: "success", text1: "Payment credited" });
        await load();
      }
    } catch {
      Toast.show({ type: "info", text1: "Payment still pending" });
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
      verifyPending();
      AsyncStorage.getItem(LAST_RATE_KEY).then((v) => {
        if (v) setLastRate(Number(v) || null);
      });
    }, [])
  );

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
  }, []);

  const recharge = async (amount: number, packageId?: string) => {
    if (!amount || amount < 10) {
      Toast.show({ type: "error", text1: "Minimum recharge ₹10" });
      return;
    }
    setLoading(true);
    try {
      const res = await walletAPI.initiate(amount, packageId);
      const orderId = res.data.order_id;
      if (orderId) await AsyncStorage.setItem(PENDING_ORDER_KEY, orderId);
      const url = res.data.payment_url;
      if (url) await Linking.openURL(url);
      Toast.show({
        type: "info",
        text1: "Complete payment",
        text2: "Return via voxora://wallet",
      });
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Recharge failed",
        text2: e?.response?.data?.detail || e.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const withdraw = async () => {
    const amount = Number(withdrawAmt);
    if (!amount || amount < 100) {
      Toast.show({ type: "error", text1: "Minimum withdrawal ₹100" });
      return;
    }
    if (!upi.trim() || !upi.includes("@")) {
      Toast.show({ type: "error", text1: "Enter a valid UPI ID" });
      return;
    }
    setLoading(true);
    try {
      await walletAPI.withdraw(amount, upi.trim());
      Toast.show({ type: "success", text1: "Withdrawal requested" });
      setWithdrawAmt("");
      await load();
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Withdraw failed",
        text2: e?.response?.data?.detail || e.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const minutesEstimate = (amount: number) => {
    if (!lastRate || lastRate <= 0) return null;
    return Math.floor(amount / lastRate);
  };

  return (
    <View style={styles.wrap}>
      <AppText style={styles.brand}>Wallet</AppText>

      <Animated.View entering={FadeInDown.duration(380)} style={[styles.balanceCard, balAnim]}>
        <AppText style={styles.balLabel}>
          {successFlash ? "Balance updated" : "Spendable (calls & gifts)"}
        </AppText>
        <AppText style={styles.bal}>₹{balance.toFixed(2)}</AppText>
        {lastRate ? (
          <AppText style={styles.estimate}>
            ~{Math.floor(balance / lastRate)} min at last rate (₹{lastRate}/min)
          </AppText>
        ) : null}
      </Animated.View>

      {isCreator ? (
        <Animated.View entering={FadeInDown.delay(80).duration(380)} style={styles.earnCard}>
          <AppText style={styles.earnLabel}>Creator earnings</AppText>
          <AppText style={styles.earnBal}>₹{earnings.toFixed(2)}</AppText>
          <AppText style={styles.commissionHint}>
            After ~15% platform commission on calls & gifts
          </AppText>
          <AppText variant="label" style={{ marginTop: 14, color: "rgba(255,255,255,0.65)" }}>
            Withdraw to UPI
          </AppText>
          <TextInput
            style={styles.wdInput}
            placeholder="Amount"
            placeholderTextColor="rgba(255,255,255,0.45)"
            keyboardType="number-pad"
            value={withdrawAmt}
            onChangeText={setWithdrawAmt}
          />
          <TextInput
            style={styles.wdInput}
            placeholder="name@upi"
            placeholderTextColor="rgba(255,255,255,0.45)"
            autoCapitalize="none"
            value={upi}
            onChangeText={setUpi}
          />
          <PrimaryButton label="Request withdrawal" onPress={withdraw} loading={loading} style={{ marginTop: 10 }} />
        </Animated.View>
      ) : earnings > 0 ? (
        <AppText variant="caption" style={{ paddingHorizontal: 24 }}>
          Referral / misc earnings: ₹{earnings.toFixed(2)}
        </AppText>
      ) : null}

      <AppText variant="label" style={styles.section}>
        Recharge packs
      </AppText>
      <View style={styles.packRow}>
        {packages.map((p) => {
          const mins = minutesEstimate(p.amount + (p.bonus || 0));
          return (
            <Pressable
              key={p.id}
              style={styles.pack}
              onPress={() => recharge(p.amount, p.id)}
              disabled={loading}
            >
              <AppText variant="caption">{p.label}</AppText>
              <AppText style={styles.packAmt}>₹{p.amount}</AppText>
              {p.bonus > 0 && <AppText style={styles.bonus}>+₹{p.bonus}</AppText>}
              {mins != null && <AppText style={styles.mins}>~{mins} min</AppText>}
            </Pressable>
          );
        })}
      </View>

      <AppText variant="label" style={styles.section}>
        Custom amount
      </AppText>
      <View style={styles.customRow}>
        <TextInput
          style={styles.customInput}
          keyboardType="number-pad"
          placeholder="Amount in ₹"
          placeholderTextColor={theme.colors.textMuted}
          value={customAmount}
          onChangeText={setCustomAmount}
        />
        <PrimaryButton
          label="Pay"
          loading={loading}
          onPress={() => recharge(Number(customAmount))}
          style={{ width: 100 }}
        />
      </View>

      <PrimaryButton
        label="Verify pending payment"
        onPress={verifyPending}
        variant="ghost"
        style={{ marginHorizontal: 24, marginTop: 12 }}
      />

      <AppText variant="label" style={styles.section}>
        Ledger
      </AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 20 }}>
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

      <FlatList
        data={filteredTxs}
        keyExtractor={(i) => i.transaction_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 }}
        renderItem={({ item }) => (
          <Card style={styles.tx}>
            <View style={styles.txRow}>
              <AppText style={styles.txType}>{item.type}</AppText>
              <AppText style={styles.txAmt}>₹{Number(item.amount).toFixed(2)}</AppText>
            </View>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, paddingTop: 64 },
  brand: {
    fontFamily: theme.font.display,
    fontSize: 36,
    color: theme.colors.brand,
    paddingHorizontal: 24,
  },
  balanceCard: {
    margin: 24,
    marginBottom: 8,
    backgroundColor: theme.colors.brandDark,
    borderRadius: theme.radius.xl,
    padding: 24,
  },
  balLabel: { color: "rgba(243,239,232,0.7)", fontFamily: theme.font.bodySemi },
  bal: { color: theme.colors.onBrand, fontSize: 40, fontFamily: theme.font.display, marginTop: 4 },
  estimate: {
    color: "rgba(243,239,232,0.75)",
    marginTop: 10,
    fontFamily: theme.font.body,
    fontSize: 13,
  },
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
  wdInput: {
    marginTop: 8,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 14,
    color: theme.colors.text,
    fontFamily: theme.font.body,
  },
  section: { paddingHorizontal: 24, marginTop: 16, marginBottom: 10 },
  packRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 24 },
  pack: {
    width: "30%",
    flexGrow: 1,
    backgroundColor: theme.colors.backgroundElevated,
    borderRadius: theme.radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
  },
  packAmt: {
    fontSize: 18,
    fontFamily: theme.font.bodyBold,
    color: theme.colors.text,
    marginTop: 4,
  },
  bonus: { fontSize: 11, color: theme.colors.brand, fontFamily: theme.font.bodyBold, marginTop: 2 },
  mins: { fontSize: 11, color: theme.colors.textSecondary, marginTop: 4, fontFamily: theme.font.body },
  customRow: { flexDirection: "row", gap: 10, paddingHorizontal: 24, alignItems: "center" },
  customInput: {
    flex: 1,
    height: 52,
    backgroundColor: theme.colors.backgroundElevated,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 14,
    fontFamily: theme.font.body,
    color: theme.colors.text,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    marginRight: 8,
  },
  chipOn: { backgroundColor: theme.colors.brand },
  chipText: { fontFamily: theme.font.bodySemi, fontSize: 12, color: theme.colors.textSecondary },
  chipTextOn: { color: theme.colors.onBrand },
  tx: { marginBottom: 8, paddingVertical: 12 },
  txRow: { flexDirection: "row", justifyContent: "space-between" },
  txType: { fontFamily: theme.font.bodySemi, color: theme.colors.text },
  txAmt: { color: theme.colors.textSecondary, fontFamily: theme.font.body },
});
