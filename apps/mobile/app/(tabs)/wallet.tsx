import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  FlatList,
  Pressable,
  Linking,
  RefreshControl,
  TextInput,
} from "react-native";
import { useFocusEffect } from "expo-router";
import * as LinkingExpo from "expo-linking";
import Toast from "react-native-toast-message";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { walletAPI } from "../../src/services/api";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { AppText, Card } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";
import * as Haptics from "expo-haptics";

const PENDING_ORDER_KEY = "pending_recharge_order";
const LAST_RATE_KEY = "last_viewed_audio_rate";

export default function WalletScreen() {
  const [balance, setBalance] = useState(0);
  const [earnings, setEarnings] = useState(0);
  const [packages, setPackages] = useState<any[]>([]);
  const [txs, setTxs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [lastRate, setLastRate] = useState<number | null>(null);
  const [successFlash, setSuccessFlash] = useState(false);
  const scale = useSharedValue(1);
  const prevBalance = useRef(0);

  const balAnim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

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
      Toast.show({ type: "info", text1: "Payment still pending", text2: "We'll keep checking" });
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
      if (url?.includes("wallet")) {
        verifyPending();
      }
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
        text2: "Return via voxora://wallet — we'll verify automatically",
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

  const minutesEstimate = (amount: number) => {
    if (!lastRate || lastRate <= 0) return null;
    const credit = amount;
    return Math.floor(credit / lastRate);
  };

  return (
    <View style={styles.wrap}>
      <AppText style={styles.brand}>Wallet</AppText>
      <Animated.View style={[styles.balanceCard, balAnim]}>
        <AppText style={styles.balLabel}>
          {successFlash ? "Balance updated" : "Spendable"}
        </AppText>
        <AppText style={styles.bal}>₹{balance.toFixed(2)}</AppText>
        <AppText style={styles.earn}>Earnings: ₹{earnings.toFixed(2)}</AppText>
        {lastRate ? (
          <AppText style={styles.estimate}>
            ~{Math.floor(balance / lastRate)} min at last viewed rate (₹{lastRate}/min)
          </AppText>
        ) : null}
      </Animated.View>

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
              {p.bonus > 0 && (
                <AppText style={styles.bonus}>+₹{p.bonus}</AppText>
              )}
              {mins != null && (
                <AppText style={styles.mins}>~{mins} min</AppText>
              )}
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
      {customAmount && minutesEstimate(Number(customAmount)) != null ? (
        <AppText variant="caption" style={{ paddingHorizontal: 24, marginTop: 6 }}>
          ≈ {minutesEstimate(Number(customAmount))} minutes at last viewed rate
        </AppText>
      ) : null}

      <PrimaryButton
        label="Verify pending payment"
        onPress={verifyPending}
        variant="ghost"
        style={{ marginHorizontal: 24, marginTop: 12 }}
      />

      <AppText variant="label" style={styles.section}>
        History
      </AppText>
      <FlatList
        data={txs}
        keyExtractor={(i) => i.transaction_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
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
  balLabel: {
    color: "rgba(255,255,255,0.7)",
    fontFamily: theme.font.bodySemi,
  },
  bal: {
    color: "#fff",
    fontSize: 40,
    fontFamily: theme.font.display,
    marginTop: 4,
  },
  earn: {
    color: theme.colors.accent,
    marginTop: 8,
    fontFamily: theme.font.bodySemi,
  },
  estimate: {
    color: "rgba(255,255,255,0.75)",
    marginTop: 10,
    fontFamily: theme.font.body,
    fontSize: 13,
  },
  section: {
    paddingHorizontal: 24,
    marginTop: 16,
    marginBottom: 10,
  },
  packRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 24,
  },
  pack: {
    width: "30%",
    flexGrow: 1,
    backgroundColor: "#fff",
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
  bonus: {
    fontSize: 11,
    color: theme.colors.brand,
    fontFamily: theme.font.bodyBold,
    marginTop: 2,
  },
  mins: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 4,
    fontFamily: theme.font.body,
  },
  customRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  customInput: {
    flex: 1,
    height: 52,
    backgroundColor: "#fff",
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 14,
    fontFamily: theme.font.body,
    color: theme.colors.text,
  },
  tx: { marginBottom: 8, paddingVertical: 12 },
  txRow: { flexDirection: "row", justifyContent: "space-between" },
  txType: { fontFamily: theme.font.bodySemi, color: theme.colors.text },
  txAmt: { color: theme.colors.textSecondary, fontFamily: theme.font.body },
});
