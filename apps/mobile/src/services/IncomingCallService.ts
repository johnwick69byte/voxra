/**
 * Incoming call notifications — Notifee full-screen CALL category (Android).
 * iOS CallKit via CallKeepService when native module is present.
 * Lazy-loads Notifee so Expo Go can boot without native binaries.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { reportIncomingCallToCallKit as displayCallKit, endCallKeepCall } from "./CallKeepService";
import { hasNotifeeNative } from "./nativeAvailability";

const PENDING_CALL_KEY = "pending_incoming_call";
const API_URL = process.env.EXPO_PUBLIC_API_URL || "https://voxra-dkfe.onrender.com/api";

function getNotifee(): any | null {
  if (!hasNotifeeNative()) return null;
  try {
    const mod = require("@notifee/react-native");
    return mod.default || mod;
  } catch {
    return null;
  }
}

export async function showIncomingCallNotification(data: Record<string, any>) {
  const notifee = getNotifee();
  if (!notifee) {
    console.warn("[incoming] Notifee unavailable — open in-app incoming screen via socket only");
    return;
  }
  const AndroidImportance = notifee.AndroidImportance || require("@notifee/react-native").AndroidImportance;
  const { AndroidCategory, AndroidVisibility, AndroidColor } = require("@notifee/react-native");

  const channelId = await notifee.createChannel({
    id: "incoming_calls_v1",
    name: "Incoming Calls",
    importance: AndroidImportance.HIGH,
    sound: "default",
    vibration: true,
    vibrationPattern: [300, 500, 300, 500],
  });

  const callerName = data.caller_name || data.callerName || "Someone";
  const callType = String(data.call_type || data.callType || "AUDIO").toUpperCase();
  const callId = data.call_id || data.callId || "";

  await notifee.displayNotification({
    id: `call_${callId}`,
    title: `Incoming ${callType === "VIDEO" ? "Video" : "Audio"} Call`,
    body: `${callerName} is calling you`,
    data: {
      call_id: callId,
      caller_id: data.caller_id || "",
      caller_name: callerName,
      caller_picture: data.caller_picture || "",
      call_type: callType,
      channel_name: data.channel_name || "",
      decline_token: data.decline_token || "",
      type: "incoming_call",
    },
    android: {
      channelId,
      importance: AndroidImportance.HIGH,
      category: AndroidCategory.CALL,
      visibility: AndroidVisibility.PUBLIC,
      ongoing: true,
      autoCancel: false,
      lights: [AndroidColor.GREEN, 300, 600],
      fullScreenAction: { id: "full_screen" },
      pressAction: { id: "default" },
      actions: [
        { title: "Accept", pressAction: { id: "accept" } },
        { title: "Decline", pressAction: { id: "decline" } },
      ],
      timeoutAfter: 45000,
    },
  });
}

export async function cancelCallNotification(callId?: string) {
  const notifee = getNotifee();
  if (callId) {
    if (notifee) await notifee.cancelNotification(`call_${callId}`);
    await endCallKeepCall(callId);
  } else if (notifee) {
    await notifee.cancelAllNotifications();
  }
}

export async function savePendingCall(data: Record<string, any>) {
  await AsyncStorage.setItem(PENDING_CALL_KEY, JSON.stringify(data));
}

export async function consumePendingCall() {
  const raw = await AsyncStorage.getItem(PENDING_CALL_KEY);
  if (!raw) return null;
  await AsyncStorage.removeItem(PENDING_CALL_KEY);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function declineCallFromNotification(callId: string, declineToken: string) {
  try {
    await fetch(`${API_URL}/calls/${callId}/reject-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decline_token: declineToken }),
    });
  } catch (e) {
    console.warn("decline from notification failed", e);
  }
  await cancelCallNotification(callId);
}

export function registerNotifeeForeground() {
  const notifee = getNotifee();
  if (!notifee) return () => {};
  const { EventType } = require("@notifee/react-native");
  return notifee.onForegroundEvent(async ({ type, detail }: any) => {
    const data = detail.notification?.data || {};
    if (data.type !== "incoming_call") return;
    if (type === EventType.ACTION_PRESS && detail.pressAction?.id === "decline") {
      await declineCallFromNotification(String(data.call_id), String(data.decline_token || ""));
    }
    if (type === EventType.ACTION_PRESS && detail.pressAction?.id === "accept") {
      await savePendingCall({ ...data, action: "accept" });
    }
  });
}

export async function reportIncomingCallToCallKit(payload: Record<string, any>) {
  await displayCallKit(payload);
}
