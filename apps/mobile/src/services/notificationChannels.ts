import { Platform } from "react-native";

/**
 * Notification channel for ordinary push messages.
 *
 * The backend pins `channel_id: "app_notifications"` on every FCM notification
 * message (earnings, withdrawal approvals, support replies, broadcasts). If that
 * channel does not exist on the device, Android routes the message to a
 * fallback channel: no sound, and the launcher icon instead of our white
 * silhouette. So it must exist before the first such push arrives.
 *
 * The call channels (`incoming_calls_v1`, `ongoing_calls`) are deliberately NOT
 * created here -- IncomingCallService / CallForegroundService own them, because
 * those services also run in a headless context when the app is killed, and
 * Android ignores changes to an existing channel after creation. Duplicating
 * the definitions would only create drift.
 */

export const CHANNEL_DEFAULT = "app_notifications";

let ready: Promise<void> | null = null;

export function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== "android") return Promise.resolve();
  if (ready) return ready;

  ready = (async () => {
    try {
      // Required lazily so this module is safe to import on iOS, where the
      // native Notifee module is not linked.
      const notifee = (await import("@notifee/react-native")).default;
      const { AndroidImportance } = require("@notifee/react-native");

      await notifee.createChannel({
        id: CHANNEL_DEFAULT,
        name: "Notifications",
        importance: AndroidImportance.DEFAULT,
        sound: "default",
      });

      console.log("[notif] default channel ready");
    } catch (e) {
      // Never block startup on notifications, but allow a later retry.
      console.warn("[notif] channel setup failed", e);
      ready = null;
    }
  })();

  return ready;
}
