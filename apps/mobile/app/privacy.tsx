import { ScrollView, StyleSheet } from "react-native";
import { AppText } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

export default function Privacy() {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 24, paddingTop: 64, paddingBottom: 48 }}>
      <AppText style={styles.title}>Privacy Policy</AppText>
      <AppText style={styles.meta}>Last updated: 2 October 2026. This policy can change. The latest version in the app applies. Continued use is acceptance.</AppText>
      <AppText style={styles.body}>
        Simple Talk, owned by Gandapodi V Saathvik, is only a technology bridge between a fan (user) and an independent creator (model) for an instant audio or video call. We are not a party to the call and we do not control what either person says or does. We do not sell personal data. We do act on reports of misuse or illegal use.
      </AppText>
      <AppText style={styles.h}>Data we collect</AppText>
      <AppText style={styles.body}>
        Account details (phone number, name, username, profile photo, bio, fan or creator role), creator verification selfie, rates and availability, device push tokens, call metadata (who called, audio or video, duration, rates, status), ratings, reports, blocks, wallet balances, recharge order IDs, gift amounts, commission, UPI ID for withdrawals, referral codes, and support messages. Microphone and camera are used only during a call, with your permission. We do not store a recording of the call.
      </AppText>
      <AppText style={styles.h}>How we use data</AppText>
      <AppText style={styles.body}>
        To sign you in, show profiles, route calls, bill prepaid minutes and gifts, credit creator earnings after the platform fee, send notifications, prevent fraud, and investigate misuse. Processors handle SMS OTP, database and cache, push, live audio and video transport, photo hosting, and payment collection. They process data only for those services.
      </AppText>
      <AppText style={styles.h}>Sharing</AppText>
      <AppText style={styles.body}>
        Other users see the profile fields you publish. Call participants see who is on the session. We share data with the processors above, with payment and payout partners, and when the law requires it or we must preserve evidence of misuse. We are not responsible for information you choose to say on a call.
      </AppText>
      <AppText style={styles.h}>Retention and deletion</AppText>
      <AppText style={styles.body}>
        You may request account deletion from Profile. We deactivate the account and schedule removal of personal identifiers, except records we must keep for fraud, disputes, tax, or the law.
      </AppText>
      <AppText style={styles.h}>Children</AppText>
      <AppText style={styles.body}>
        Simple Talk is only for people 18 or older. Accounts used by minors, or calls involving anyone under 18, will be removed.
      </AppText>
      <AppText style={styles.h}>Contact</AppText>
      <AppText style={styles.body}>
        Privacy requests: gambiraojas6@gmail.com, or support in Profile. Include the phone number on the account. You can also request deletion from the website account-deletion page.
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
