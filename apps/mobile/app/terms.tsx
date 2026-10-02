import { ScrollView, StyleSheet } from "react-native";
import { AppText } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

export default function Terms() {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 24, paddingTop: 64, paddingBottom: 48 }}>
      <AppText style={styles.title}>Terms and Conditions</AppText>
      <AppText style={styles.meta}>Last updated: 2 October 2026. These terms can change at any time. The latest version in the app applies. Continued use is acceptance.</AppText>
      <AppText style={styles.h}>We are only a bridge</AppText>
      <AppText style={styles.body}>
        Simple Talk, owned by Gandapodi V Saathvik, only connects a user (fan) with an independent creator (model) and settles the prepaid fee. We do not employ creators, we do not provide the conversation, and we are not a party to the call. Anything said, shown, promised, or agreed on the call is solely between those two people.
      </AppText>
      <AppText style={styles.h}>What we are not responsible for</AppText>
      <AppText style={styles.body}>
        We are not responsible for user or creator conduct, advice, identity claims, off-platform contact or payments, recordings made by either person, call quality, or whether a creator answers. Network conditions and device permissions can affect a call. To the extent the law allows, liability for a claim about the platform is limited to what you paid in the three months before the claim, or unpaid earnings still owed to you, whichever is greater.
      </AppText>
      <AppText style={styles.h}>Misuse and illegal use</AppText>
      <AppText style={styles.body}>
        We will act on misuse and illegal use. We may warn, restrict, suspend, or permanently close an account, remove material, delay or forfeit pending earnings where the law allows, keep records, and share information with payment partners or lawful authorities. You can report a call or block a user. A report does not make us responsible for what already happened.
      </AppText>
      <AppText style={styles.h}>Accounts and calls</AppText>
      <AppText style={styles.body}>
        You must be 18 or older and provide accurate profile information. Creators must pass verification before paid calls. Billing starts when a call is live, at the creator’s published per-minute rate, from the fan’s spendable wallet. Decline, cancel, and no-answer are not completed paid sessions. Gifts sent on a live call are non-refundable once delivered.
      </AppText>
      <AppText style={styles.h}>Wallet</AppText>
      <AppText style={styles.body}>
        Recharges are prepaid credits, not a bank deposit. A 15% platform commission applies to calls and gifts, so the creator receives about 85%. Earnings are a separate balance. UPI withdrawals start at ₹100 and are reviewed. Referral bonuses, currently ₹25 and ₹20 on a friend’s first recharge, can change or end.
      </AppText>
      <AppText style={styles.h}>Acceptable use</AppText>
      <AppText style={styles.body}>
        No illegal content, scams, harassment, sexual content involving anyone under 18, impersonation, or attempts to move payment off the platform to avoid fees. Creators are responsible for what they offer and for tax on their earnings.
      </AppText>
      <AppText style={styles.h}>Contact</AppText>
      <AppText style={styles.body}>
        Questions: gambiraojas6@gmail.com, or support in Profile. Include the phone number on the account. These terms are governed by the laws of India. Disputes about the platform are subject to the courts in Hyderabad.
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
    marginBottom: 8,
  },
  meta: {
    fontFamily: theme.font.body,
    fontSize: 13,
    lineHeight: 20,
    color: theme.colors.textSecondary,
    marginBottom: 8,
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
