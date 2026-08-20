import { Platform } from "react-native";
import { creatorsAPI } from "./api";
import { ensureNotificationPermission } from "./permissions";
import { hasFirebaseNative } from "./nativeAvailability";

/** Register FCM token with backend after login. Safe no-op without Firebase native. */
export async function registerDevicePushToken(): Promise<void> {
  if (!hasFirebaseNative()) {
    console.warn("[push] skipped — Firebase native not linked (use EAS/dev client)");
    return;
  }
  try {
    await ensureNotificationPermission();
    const messagingModule = require("@react-native-firebase/messaging");
    const messaging = messagingModule.default || messagingModule;
    await messaging().registerDeviceForRemoteMessages?.();
    const token = await messaging().getToken();
    if (token) {
      await creatorsAPI.pushToken(token, Platform.OS);
    }
  } catch (e) {
    console.warn("[push] token registration skipped:", (e as Error)?.message);
  }
}
