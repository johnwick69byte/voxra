import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";

const KEY = "accepted_call_disclaimer_at";
const SKIP_KEY = "call_disclaimer_dont_show";

const MESSAGE =
  "By continuing you confirm you are 18+.\n\n" +
  "• Calls are billed per minute from your wallet\n" +
  "• Whatever either person says or does on the call is their own action and responsibility, not the platform's\n" +
  "• Abuse, nudity, or illegal activity is strictly prohibited and will result in a ban";

/**
 * One-time first-call notice. The 18+ / no-abuse policy is also shown inline on
 * every creator profile, so this is only a confirmation before the first call.
 */
export async function ensureCallDisclaimer(): Promise<boolean> {
  try {
    const skip = await AsyncStorage.getItem(SKIP_KEY);
    if (skip === "1") return true;
  } catch {
    /* continue */
  }

  return new Promise((resolve) => {
    Alert.alert("Before you call", MESSAGE, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      {
        text: "I agree",
        onPress: async () => {
          await AsyncStorage.setItem(SKIP_KEY, "1");
          await AsyncStorage.setItem(KEY, new Date().toISOString());
          resolve(true);
        },
      },
    ]);
  });
}
