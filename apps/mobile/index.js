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
    const { emitCallRoute } = require("./src/services/callRouter");
    const {
      displayGeneralNotification,
      routeGeneralNotification,
    } = require("./src/services/inAppNotifications");

    function routeIfCall(data) {
      if (data && data.type === "incoming_call") {
        emitCallRoute({ ...data, action: "ring" });
        return true;
      }
      return false;
    }

    /**
     * Foreground push messages.
     *
     * Android draws FCM `notification` messages from the system tray only when
     * the app is backgrounded or killed. In the FOREGROUND the message is
     * delivered here and nothing appears unless we draw it ourselves -- which is
     * why "creator is online" and "you're approved" produced no visible
     * notification while using the app.
     */
    messaging().onMessage(async (remoteMessage) => {
      const data = remoteMessage?.data || {};
      if (data.type === "incoming_call") {
        // A notification message is not auto-displayed in the foreground.
        // Route it into the single incoming-call gate instead of drawing a
        // second notification; the in-app screen owns the ringtone/UI.
        emitCallRoute({ ...data, action: "ring" });
        return;
      }
      // Non-call notifications: display via inAppNotifications
      const title = remoteMessage?.notification?.title;
      const body = remoteMessage?.notification?.body;
      await displayGeneralNotification({ ...data, title, body });
    });

    // A call arrives as a notification message. Android/iOS render it
    // themselves in the background and killed states, using
    // incoming_calls_v2 + the custom sound_effect resource. The headless task
    // only persists the payload as a fallback for cold-start recovery; it must
    // NOT draw a second notification.
    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      const data = remoteMessage?.data || {};
      if (data.type !== "incoming_call") return;
      const { savePendingCall } = require("./src/services/IncomingCallService");
      await savePendingCall({ ...data, action: "ring" });
    });

    // Tapped a notification that cold-started the app.
    messaging()
      .getInitialNotification()
      .then(async (remoteMessage) => {
        const data = remoteMessage?.data || {};
        if (!routeIfCall(data)) await routeGeneralNotification(data);
      })
      .catch(() => {});

    // Tapped a notification while the app was backgrounded.
    messaging().onNotificationOpenedApp(async (remoteMessage) => {
      const data = remoteMessage?.data || {};
      if (!routeIfCall(data)) await routeGeneralNotification(data);
    });

    // Foreground notification message. Handled above via onMessage so we can
    // draw non-call pushes ourselves.
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
    const { declineCallFromNotification } = require("./src/services/IncomingCallService");
    const { emitCallRoute } = require("./src/services/callRouter");

    notifee.onBackgroundEvent(async ({ type, detail }) => {
      const data = detail.notification?.data || {};

      // Non-call notifications: tapping opens the notification centre.
      if (data.type !== "incoming_call") {
        if (type === EventType.PRESS || type === EventType.ACTION_PRESS) {
          try {
            const { queueNavigation } = require("./src/services/navigationQueue");
            queueNavigation("/notifications");
          } catch {
            /* ignore */
          }
        }
        return;
      }

      if (type === EventType.ACTION_PRESS && detail.pressAction?.id === "decline") {
        await declineCallFromNotification(
          String(data.call_id || ""),
          String(data.decline_token || "")
        );
        return;
      }
      if (type === EventType.ACTION_PRESS && detail.pressAction?.id === "accept") {
        emitCallRoute({ ...data, action: "accept" });
      } else if (type === EventType.PRESS || type === EventType.ACTION_PRESS) {
        emitCallRoute({ ...data, action: "ring" });
      }
      try {
        await notifee.cancelNotification(`call_${data.call_id}`);
      } catch {
        /* ignore */
      }
    });
  } catch (e) {
    console.warn("[Notifee] background handler not registered:", e?.message || e);
  }
}

require("expo-router/entry");
