/**
 * Custom entry — register FCM/Notifee background handlers before Expo Router.
 */
const messagingModule = require("@react-native-firebase/messaging");
const messaging = messagingModule.default || messagingModule;
const notifeeModule = require("@notifee/react-native");
const notifee = notifeeModule.default || notifeeModule;
const { EventType } = notifeeModule;
const AsyncStorage = require("@react-native-async-storage/async-storage").default;

const {
  showIncomingCallNotification,
  declineCallFromNotification,
  savePendingCall,
} = require("./src/services/IncomingCallService");

messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  const data = remoteMessage?.data || {};
  if (data.type === "incoming_call") {
    // Data-only FCM → display full-screen call notification via Notifee
    await showIncomingCallNotification(data);
  }
});

notifee.onBackgroundEvent(async ({ type, detail }) => {
  const data = detail.notification?.data || {};
  if (data.type !== "incoming_call") return;
  if (type === EventType.ACTION_PRESS && detail.pressAction?.id === "decline") {
    await declineCallFromNotification(data.call_id, data.decline_token || "");
  }
  if (
    (type === EventType.ACTION_PRESS && detail.pressAction?.id === "accept") ||
    type === EventType.PRESS
  ) {
    await savePendingCall(data);
    await notifee.cancelAllNotifications();
  }
});

require("expo-router/entry");
