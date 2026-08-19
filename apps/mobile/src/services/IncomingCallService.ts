/**
 * Incoming call notifications — Notifee full-screen CALL category (Android).
 * iOS CallKit via CallKeepService when native module is present.
 */
import notifee, {
  AndroidImportance,
  AndroidCategory,
  AndroidVisibility,
  AndroidColor,
  EventType,
} from "@notifee/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { reportIncomingCallToCallKit as displayCallKit, endCallKeepCall } from "./CallKeepService";

const PENDING_CALL_KEY = "pending_incoming_call";
const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:8000/api";

export async function showIncomingCallNotification(data: Record<string, any>) {
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
  if (callId) {
    await notifee.cancelNotification(`call_${callId}`);
    await endCallKeepCall(callId);
  } else {
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
  return notifee.onForegroundEvent(async ({ type, detail }) => {
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
