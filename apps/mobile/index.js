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
        try {
          const notifeeModule = require("@notifee/react-native");
          const notifee = notifeeModule.default || notifeeModule;
          const { AndroidImportance } = notifeeModule;

          const callId = String(data.call_id || "");
          const callerName = String(data.caller_name || "Someone");
          const callType = String(data.call_type || "AUDIO").toUpperCase();
          const channelId = "incoming_calls_v1";

          await notifee.createChannel({
            id: channelId,
            name: "Incoming Calls",
            importance: AndroidImportance.MAX,
            sound: "default",
            vibration: true,
            vibrationPattern: [300, 500, 300, 500],
            bypassDnd: true,
            lights: true,
          });

          const fullScreenIntent = { id: "full_screen", launchActivity: "default" };

          await notifee.displayNotification({
            id: `call_${callId}`,
            title: `Incoming ${callType === "VIDEO" ? "Video" : "Audio"} Call`,
            body: `${callerName} is calling you`,
            data: { ...data, type: "incoming_call", action: "ring" },
            android: {
              channelId,
              smallIcon: "ic_notification",
              importance: AndroidImportance.MAX,
              category: "call",
              visibility: "public",
              ongoing: true,
              autoCancel: false,
              loopSound: true,
              lights: [0x00FF00, 300, 600],
              fullScreenAction: { id: "full_screen", launchActivity: "default" },
              pressAction: { id: "default", launchActivity: "default" },
              actions: [
                { title: "Accept", pressAction: { id: "accept", launchActivity: "default" } },
                { title: "Decline", pressAction: { id: "decline" } },
              ],
              timeoutAfter: 45000,
            },
          });
        } catch (e) {
          console.warn("[FCM] foreground call notification failed:", e?.message || e);
        }
        return;
      }
      // Non-call notifications: display via inAppNotifications
      const title = remoteMessage?.notification?.title;
      const body = remoteMessage?.notification?.body;
      await displayGeneralNotification({ ...data, title, body });
    });

    // A call arrives as a data message while the process is alive, or as a
    // notification message (the killed/backgrounded path). Android renders the
    // FCM notification itself, so we do NOT display a second one.
    //
    // The WhatsApp-style full-screen call UI comes from Notifee with
    // fullScreenIntent, which drives Android Telecom. RNFirebase starts a
    // headless JS task for background messages (see
    // ReactNativeFirebaseMessagingReceiver), so this runs even when the app
    // was swiped away -- provided the message is high priority, which the
    // backend sets.
    messaging().setBackgroundMessageHandler(async (remoteMessage) => {
      const data = remoteMessage?.data || {};
      if (data.type !== "incoming_call") return;

      // The headless task runs in a SEPARATE JS context from the app, so
      // in-memory routing cannot reach the UI. Persist it instead; _layout
      // consumes this on mount, and the notification tap routes normally.
      const { savePendingCall } = require("./src/services/IncomingCallService");
      await savePendingCall({ ...data, action: "ring" });

      // Display a Notifee notification with fullScreenIntent to launch the
      // full-screen call UI. This runs in the headless JS task and works
      // even when the app was killed/swiped away.
      try {
        const notifeeModule = require("@notifee/react-native");
        const notifee = notifeeModule.default || notifeeModule;
        const { AndroidImportance, AndroidCategory } = notifeeModule;

        const channelId = "incoming_calls_v1";
        const callId = String(data.call_id || "");
        const callerName = String(data.caller_name || "Someone");
        const callType = String(data.call_type || "AUDIO").toUpperCase();

        // Create the channel if needed (idempotent)
        await notifee.createChannel({
          id: channelId,
          name: "Incoming Calls",
          importance: AndroidImportance.MAX,
          sound: "default",
          vibration: true,
          vibrationPattern: [300, 500, 300, 500],
          bypassDnd: true,
          lights: true,
        });

        // Create a full-screen intent that launches the call screen
        const fullScreenIntent = {
          id: "full_screen",
          launchActivity: "default",
        };

        await notifee.displayNotification({
          id: `call_${callId}`,
          title: `Incoming ${callType === "VIDEO" ? "Video" : "Audio"} Call`,
          body: `${callerName} is calling you`,
          data: {
            ...data,
            type: "incoming_call",
            action: "ring",
          },
          android: {
            channelId,
            smallIcon: "ic_notification",
            importance: AndroidImportance.MAX,
            category: "call",
            visibility: "public",
            ongoing: true,
            autoCancel: false,
            loopSound: true,
            lights: [0x00FF00, 300, 600],
            fullScreenAction: fullScreenIntent,
            pressAction: { id: "default", launchActivity: "default" },
            actions: [
              { title: "Accept", pressAction: { id: "accept", launchActivity: "default" } },
              { title: "Decline", pressAction: { id: "decline" } },
            ],
            timeoutAfter: 45000,
          },
        });
      } catch (e) {
        console.warn("[FCM] background call notification failed:", e?.message || e);
      }
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
