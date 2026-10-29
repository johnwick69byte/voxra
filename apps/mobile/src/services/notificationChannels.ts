import { Platform } from "react-native";

/**
 * Android notification channels.
 *
 * The backend pins `channel_id` on every FCM notification message. If the
 * channel does not exist on the device, Android routes the message to a
 * fallback channel: no custom sound, and the launcher icon instead of our white
 * silhouette. Both channels therefore have to exist before the first push.
 *
 * Android freezes a channel's sound/vibration settings at creation time. The
 * incoming-call channel is v2 (not v1) because v1 was shipped with the system
 * default sound; existing installs would keep the old sound forever if we
 * reused the same id. If the sound changes again, bump this id.
 *
 * `sound_effect.mp3` is installed into `android/app/src/main/res/raw/` by
 * plugins/withNotificationSound.js. Notifee/FCM refer to the raw resource by
 * its name without the file extension.
 */

export const CHANNEL_DEFAULT = "app_notifications";
export const CHANNEL_INCOMING_CALLS = "incoming_calls_v2";
export const INCOMING_CALL_SOUND = "sound_effect";

let ready: Promise<void> | null = null;

export function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== "android") return Promise.resolve();
  if (ready) return ready;

  ready = (async () => {
    try {
      // Required lazily so this module is safe to import on iOS.
      const notifee = (await import("@notifee/react-native")).default;
      const { AndroidImportance } = require("@notifee/react-native");

      await notifee.createChannel({
        id: CHANNEL_DEFAULT,
        name: "Notifications",
        importance: AndroidImportance.DEFAULT,
        sound: "default",
      });

      await notifee.createChannel({
        id: CHANNEL_INCOMING_CALLS,
        name: "Incoming Calls",
        importance: AndroidImportance.MAX,
        sound: INCOMING_CALL_SOUND,
        vibration: true,
        vibrationPattern: [300, 500, 300, 500],
        bypassDnd: true,
        lights: true,
      });

      console.log("[notif] notification channels ready");
    } catch (e) {
      // Never block startup on notifications, but allow a later retry.
      console.warn("[notif] channel setup failed", e);
      ready = null;
    }
  })();

  return ready;
}
