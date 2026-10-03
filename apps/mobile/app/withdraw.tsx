import { useCallback, useState } from "react";
import { View, StyleSheet, ScrollView, TextInput, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import { withdrawalAPI } from "../src/services/api";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { AppText, ScreenHeader } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

type Bank = {
  bank_name: string;
  account_number: string;
  ifsc_code: string;
  account_holder_name: string;
};

const EMPTY_BANK: Bank = {
  bank_name: "",
  account_number: "",
  ifsc_code: "",
  account_holder_name: "",
};

function inr(n: number | undefined) {
  return `₹${Number(n || 0).toFixed(2)}`;
}

export default function WithdrawScreen() {
  const router = useRouter();
  const [earnings, setEarnings] = useState(0);
  const [amount, setAmount] = useState("");
  const [upi, setUpi] = useState("");
  const [bank, setBank] = useState<Bank>(EMPTY_BANK);
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<any[]>([]);
  const [maxAmount, setMaxAmount] = useState(25000);
  const [maxPerDay, setMaxPerDay] = useState(2);
  const [today, setToday] = useState(0);

  const load = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([withdrawalAPI.profile(), withdrawalAPI.requests()]);
      setEarnings(p.data.earnings_balance || 0);
      setMaxAmount(p.data.max_withdraw_amount || 25000);
      setMaxPerDay(p.data.max_requests_per_day || 2);
      setToday(p.data.requests_today || 0);
      if (p.data.upi_id) setUpi(p.data.upi_id);
      if (p.data.bank_details) setBank({ ...EMPTY_BANK, ...p.data.bank_details });
      setRequests(r.data.requests || []);
    } catch {
      /* ignore */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt < 250) {
      Toast.show({ type: "error", text1: "Minimum withdrawal ₹250" });
      return;
    }
    if (amt > maxAmount) {
      Toast.show({ type: "error", text1: `Maximum ₹${maxAmount}` });
      return;
    }
    if (!upi.trim() || !upi.includes("@")) {
      Toast.show({ type: "error", text1: "Enter a valid UPI ID (name@bank)" });
      return;
    }
    if (!bank.bank_name || !bank.account_number || !bank.ifsc_code || !bank.account_holder_name) {
      Toast.show({ type: "error", text1: "Fill all bank details" });
      return;
    }
    setLoading(true);
    try {
      await withdrawalAPI.submit({
        amount: amt,
        upi_id: upi.trim(),
        account_name: bank.account_holder_name,
        bank_details: bank,
      });
      Toast.show({ type: "success", text1: "Withdrawal requested" });
      setAmount("");
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

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Withdraw earnings" subtitle={`${today}/${maxPerDay} requests today`} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <View style={styles.balanceCard}>
          <AppText variant="caption" color="rgba(243,239,232,0.7)">
            Available to withdraw
          </AppText>
          <AppText style={styles.balance}>{inr(earnings)}</AppText>
          <AppText variant="caption" color="rgba(243,239,232,0.7)">
            Minimum ₹250 · Maximum ₹{maxAmount}
          </AppText>
        </View>

        <AppText variant="label" style={styles.section}>Amount</AppText>
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          placeholder="Amount in ₹"
          placeholderTextColor={theme.colors.textMuted}
          value={amount}
          onChangeText={setAmount}
        />

        <AppText variant="label" style={styles.section}>UPI ID</AppText>
        <TextInput
          style={styles.input}
          placeholder="name@bank"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="none"
          value={upi}
          onChangeText={setUpi}
        />

        <AppText variant="label" style={styles.section}>Bank details</AppText>
        <TextInput
          style={styles.input}
          placeholder="Bank name"
          placeholderTextColor={theme.colors.textMuted}
          value={bank.bank_name}
          onChangeText={(v) => setBank((b) => ({ ...b, bank_name: v }))}
        />
        <TextInput
          style={styles.input}
          placeholder="Account number"
          placeholderTextColor={theme.colors.textMuted}
          keyboardType="number-pad"
          value={bank.account_number}
          onChangeText={(v) => setBank((b) => ({ ...b, account_number: v }))}
        />
        <TextInput
          style={styles.input}
          placeholder="IFSC code"
          placeholderTextColor={theme.colors.textMuted}
          autoCapitalize="characters"
          value={bank.ifsc_code}
          onChangeText={(v) => setBank((b) => ({ ...b, ifsc_code: v }))}
        />
        <TextInput
          style={styles.input}
          placeholder="Account holder name"
          placeholderTextColor={theme.colors.textMuted}
          value={bank.account_holder_name}
          onChangeText={(v) => setBank((b) => ({ ...b, account_holder_name: v }))}
        />

        <PrimaryButton label="Request withdrawal" onPress={submit} loading={loading} style={{ marginTop: 18 }} />

        <AppText variant="label" style={styles.section}>Your requests</AppText>
        {requests.length ? (
          requests.map((r) => (
            <View key={r.request_id} style={styles.reqCard}>
              <View style={{ flex: 1 }}>
                <AppText style={styles.reqAmt}>{inr(r.amount)}</AppText>
                <AppText variant="caption">{r.upi_id}</AppText>
                {r.created_at ? (
                  <AppText variant="caption">{new Date(r.created_at).toLocaleDateString()}</AppText>
                ) : null}
              </View>
              <View
                style={[
                  styles.status,
                  r.status === "PAID" && styles.statusPaid,
                  r.status === "REJECTED" && styles.statusRejected,
                ]}
              >
                <AppText
                  variant="caption"
                  color={
                    r.status === "PAID"
                      ? theme.colors.success
                      : r.status === "REJECTED"
                        ? theme.colors.error
                        : theme.colors.warning
                  }
                >
                  {r.status}
                </AppText>
              </View>
            </View>
          ))
        ) : (
          <AppText variant="caption">No withdrawal requests yet.</AppText>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  balanceCard: {
    backgroundColor: theme.colors.brandDark,
    borderRadius: theme.radius.xl,
    padding: 22,
    marginBottom: 8,
  },
  balance: { fontFamily: theme.font.display, fontSize: 36, color: theme.colors.onBrand, marginVertical: 4 },
  section: { marginTop: 20, marginBottom: 8 },
  input: {
    height: 52,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    paddingHorizontal: 16,
    color: theme.colors.text,
    fontFamily: theme.font.body,
    fontSize: 16,
    marginTop: 8,
  },
  reqCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    marginTop: 8,
  },
  reqAmt: { fontFamily: theme.font.bodyBold, color: theme.colors.text, fontSize: 16 },
  status: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: "rgba(217,119,6,0.12)",
  },
  statusPaid: { backgroundColor: "rgba(34,197,94,0.12)" },
  statusRejected: { backgroundColor: "rgba(239,68,68,0.12)" },
});
