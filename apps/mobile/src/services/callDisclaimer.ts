import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";

const KEY = "accepted_call_disclaimer_at";
const SKIP_KEY = "call_disclaimer_dont_show";

const MESSAGE =
  "By continuing you confirm you are 18+.\n\n" +
  "• Calls are billed per minute from your wallet\n" +
  "• Peers may record audio/video — do not share sensitive info\n" +
  "• Screenshots and screen recording are blocked during calls\n" +
  "• Harassment or illegal content will result in account bans";

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
        text: "Don't show again",
        onPress: async () => {
          await AsyncStorage.setItem(SKIP_KEY, "1");
          await AsyncStorage.setItem(KEY, new Date().toISOString());
          resolve(true);
        },
      },
      {
        text: "I agree",
        onPress: async () => {
          await AsyncStorage.setItem(KEY, new Date().toISOString());
          resolve(true);
        },
      },
    ]);
  });
}
