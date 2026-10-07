import { Platform } from "react-native";
import { creatorsAPI } from "./api";
import { hasFirebaseNative } from "./nativeAvailability";
import { ensureNotificationPermission } from "./permissions";

/**
 * Register the FCM token with the backend, and keep it fresh.
 *
 * Ordering matters. On Android 13+ `getToken()` succeeds even when
 * POST_NOTIFICATIONS is denied, but every message is then silently dropped --
 * the token exists, the server pushes to it, and nothing appears. So the
 * permission is requested FIRST and registration is skipped if it is refused.
 *
 * Notification permission is otherwise owned by the root layout; passing
 * `requestPermission: false` lets that path reuse this without a second prompt.
 */

let refreshBound = false;

export async function registerDevicePushToken(opts?: {
  requestPermission?: boolean;
}): Promise<void> {
  const shouldRequest = opts?.requestPermission !== false;

  if (!hasFirebaseNative()) {
    console.warn("[push] skipped - Firebase native not linked (use EAS/dev client)");
    return;
  }

  if (shouldRequest) {
    const granted = await ensureNotificationPermission();
    if (!granted) {
      // Registering anyway would create a token that can never display
      // anything. Skip, and retry on the next app start.
      console.warn("[push] notification permission not granted - skipping token registration");
      return;
    }
  }

  try {
    const messagingModule = require("@react-native-firebase/messaging");
    const messaging = messagingModule.default || messagingModule;

    await messaging().registerDeviceForRemoteMessages?.();
    const token = await messaging().getToken();
    if (token) {
      await creatorsAPI.pushToken(token, Platform.OS);
      console.log("[push] token registered");
    }

    // FCM rotates tokens (reinstall, restore, long idle). Without this the
    // server keeps pushing to a dead token and the user silently stops getting
    // notifications -- which looks exactly like "pushes never worked".
    if (!refreshBound && typeof messaging().onTokenRefresh === "function") {
      refreshBound = true;
      messaging().onTokenRefresh(async (next: string) => {
        try {
          if (next) await creatorsAPI.pushToken(next, Platform.OS);
          console.log("[push] token refreshed");
        } catch (e) {
          console.warn("[push] token refresh upload failed", e);
        }
      });
    }
  } catch (e) {
    console.warn("[push] token registration skipped:", (e as Error)?.message);
  }
}

/** Re-register after the user grants notifications from system settings. */
export async function syncPushTokenIfPermitted(): Promise<void> {
  await registerDevicePushToken({ requestPermission: false });
}
