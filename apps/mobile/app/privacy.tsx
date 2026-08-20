import { View, StyleSheet, ScrollView } from "react-native";
import { AppText } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

export default function Privacy() {
  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ padding: 24, paddingTop: 64, paddingBottom: 48 }}>
      <AppText style={styles.title}>Privacy Policy</AppText>
      <AppText style={styles.body}>
        Voxora (“we”) operates instant audio and video calling between fans and creators. This policy
        explains what we collect and why.
      </AppText>
      <AppText style={styles.h}>Data we collect</AppText>
      <AppText style={styles.body}>
        Account details (phone number, name, username, profile photo), creator verification selfie,
        device push tokens, call metadata (duration, rates, status), wallet and payment order IDs,
        and optional referral codes. Microphone and camera are accessed only during calls with your
        permission.
      </AppText>
      <AppText style={styles.h}>How we use data</AppText>
      <AppText style={styles.body}>
        To authenticate you, route calls, bill prepaid minutes, send call/account notifications,
        prevent fraud, and improve reliability. We do not sell personal data.
      </AppText>
      <AppText style={styles.h}>Processors</AppText>
      <AppText style={styles.body}>
        We use service providers for SMS OTP, cloud database, Redis, FCM push, Agora RTC media,
        ImageKit media hosting, and payment processing. They process data only to provide those
        services.
      </AppText>
      <AppText style={styles.h}>Retention & deletion</AppText>
      <AppText style={styles.body}>
        You may request account deletion from Profile. We deactivate the account and schedule removal
        of personal identifiers subject to legal and fraud-prevention retention needs.
      </AppText>
      <AppText style={styles.h}>Contact</AppText>
      <AppText style={styles.body}>
        For privacy requests, contact support from the in-app Profile section or your onboarding email.
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
