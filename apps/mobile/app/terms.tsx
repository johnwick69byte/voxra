import { View, StyleSheet, ScrollView } from "react-native";
import { AppText } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

export default function Terms() {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 24, paddingTop: 64, paddingBottom: 48 }}>
      <AppText style={styles.title}>Terms of Service</AppText>
      <AppText style={styles.body}>
        By using Voxora you agree to these terms. Instant audio/video sessions are prepaid from your
        wallet balance at the creator’s published per-minute rates.
      </AppText>
      <AppText style={styles.h}>Accounts</AppText>
      <AppText style={styles.body}>
        You must provide accurate profile information. Creators must complete verification and remain
        compliant with community standards. We may suspend accounts for fraud, harassment, or abuse.
      </AppText>
      <AppText style={styles.h}>Calls & billing</AppText>
      <AppText style={styles.body}>
        Billing starts when a call becomes live. Low-balance warnings may end the call. Gifts are
        optional one-time transfers during a live call and are non-refundable once delivered.
        Disconnect grace periods may apply before a call is finalized.
      </AppText>
      <AppText style={styles.h}>Wallet</AppText>
      <AppText style={styles.body}>
        Recharges are prepaid credits. Platform commission may apply to creator earnings. Withdrawals
        require valid payout details and are subject to review.
      </AppText>
      <AppText style={styles.h}>Acceptable use</AppText>
      <AppText style={styles.body}>
        No illegal content, scams, spam, or recording others without consent where prohibited.
        Violations can result in immediate bans and forfeiture of pending earnings where allowed by
        law.
      </AppText>
      <AppText style={styles.h}>Liability</AppText>
      <AppText style={styles.body}>
        Service is provided as available. Network conditions and device permissions can affect call
        quality. We are not liable for user-generated content exchanged during calls.
      </AppText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  title: {
    fontFamily: theme.font.display,
    fontSize: 28,
    color: theme.colors.brand,
    marginBottom: 16,
  },
  h: {
    fontFamily: theme.font.bodyBold,
    fontSize: 16,
    color: theme.colors.text,
    marginTop: 18,
    marginBottom: 6,
  },
  body: {
    fontFamily: theme.font.body,
    fontSize: 15,
    lineHeight: 24,
    color: theme.colors.textSecondary,
  },
});
