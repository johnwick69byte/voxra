/**
 * Custom entry — register FCM/Notifee background handlers when native modules exist.
 * Expo Go has no RNFB/Notifee binaries; skip so the JS app can still load for UI/dev.
 */
const { NativeModules } = require("react-native");

function hasFirebaseNative() {
  return !!(NativeModules && NativeModules.RNFBAppModule);
}

function hasNotifeeNative() {
  return !!(NativeModules && (NativeModules.NotifeeApiModule || NativeModules.NotifeeModule));
}

if (hasFirebaseNative()) {
  try {
    const messagingModule = require("@react-native-firebase/messaging");
    const messaging = messagingModule.default || messagingModule;
    const {
      showIncomingCallNotification,
      savePendingCall,
    } = require("./src/services/IncomingCallService");

    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      const data = remoteMessage?.data || {};
      if (data.type === "incoming_call") {
        await savePendingCall({ ...data, action: "ring" });
        await showIncomingCallNotification(data);
      }
    });
  } catch (e) {
    console.warn("[FCM] background handler not registered:", e?.message || e);
  }
} else {
  console.warn(
    "[FCM] Native Firebase missing (Expo Go?). Push/incoming-call needs an EAS/dev-client build."
  );
}

if (hasNotifeeNative()) {
  try {
    const notifeeModule = require("@notifee/react-native");
    const notifee = notifeeModule.default || notifeeModule;
    const { EventType } = notifeeModule;
    const {
      declineCallFromNotification,
      savePendingCall,
    } = require("./src/services/IncomingCallService");

    notifee.onBackgroundEvent(async ({ type, detail }) => {
      const data = detail.notification?.data || {};
      if (data.type !== "incoming_call") return;
      if (type === EventType.ACTION_PRESS && detail.pressAction?.id === "decline") {
        await declineCallFromNotification(
          String(data.call_id || ""),
          String(data.decline_token || "")
        );
        return;
      }
      if (
        (type === EventType.ACTION_PRESS && detail.pressAction?.id === "accept") ||
        type === EventType.PRESS ||
        type === EventType.ACTION_PRESS
      ) {
        await savePendingCall({ ...data, action: "accept" });
        try {
          await notifee.cancelNotification(`call_${data.call_id}`);
        } catch {
          await notifee.cancelAllNotifications();
        }
      }
    });
  } catch (e) {
    console.warn("[Notifee] background handler not registered:", e?.message || e);
  }
}

require("expo-router/entry");
