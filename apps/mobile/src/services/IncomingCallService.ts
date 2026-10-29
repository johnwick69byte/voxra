/**
 * Incoming-call persistence and legacy notification handling.
 *
 * New calls are delivered as FCM notification messages and rendered by the OS.
 * This module keeps the payload across the headless -> UI process boundary,
 * clears it as soon as the call is handled, and keeps the old Notifee call
 * notification actions working for users upgrading from an older build.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { endCallKeepCall } from "./CallKeepService";
import { hasNotifeeNative } from "./nativeAvailability";

const PENDING_CALL_KEY = "pending_incoming_call";
// The server stops ringing after CALL_RING_TIMEOUT_SECONDS (45). Anything much
// older is stale and must never open an incoming screen on a later launch.
const PENDING_CALL_MAX_AGE_MS = 90_000;
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

export async function savePendingCall(data: Record<string, any>) {
  // saved_at is overwritten even when an older payload is re-saved, so a
  // duplicate FCM delivery cannot make a stale call look fresh.
  await AsyncStorage.setItem(
    PENDING_CALL_KEY,
    JSON.stringify({ ...data, saved_at: Date.now() })
  );
}

export async function consumePendingCall() {
  const raw = await AsyncStorage.getItem(PENDING_CALL_KEY);
  if (!raw) return null;
  await AsyncStorage.removeItem(PENDING_CALL_KEY);
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.call_id) return null;
    const savedAt = Number(parsed.saved_at || 0);
    if (savedAt && Date.now() - savedAt > PENDING_CALL_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Remove a pending call, but only when it belongs to `callId`. */
export async function clearPendingCall(callId?: string) {
  if (!callId) {
    await AsyncStorage.removeItem(PENDING_CALL_KEY);
    return;
  }
  const raw = await AsyncStorage.getItem(PENDING_CALL_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.call_id || parsed.call_id === callId) {
      await AsyncStorage.removeItem(PENDING_CALL_KEY);
    }
  } catch {
    await AsyncStorage.removeItem(PENDING_CALL_KEY);
  }
}

/**
 * Cancel the local call notification (and legacy CallKeep UI) for a call.
 *
 * FCM notification messages cannot be cancelled by JS, but any Notifee call
 * notification from an older build can. This also clears the persisted payload
 * so a later cold start cannot resurrect a call that has already ended.
 */
export async function cancelCallNotification(callId?: string) {
  const notifee = getNotifee();
  if (callId) {
    if (notifee) {
      try {
        await notifee.cancelNotification(`call_${callId}`);
      } catch {
        /* ignore */
      }
    }
    await endCallKeepCall(callId);
    await clearPendingCall(callId);
  } else if (notifee) {
    await notifee.cancelAllNotifications();
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
  const { emitCallRoute } = require("./callRouter");
  return notifee.onForegroundEvent(async ({ type, detail }: any) => {
    if (type !== EventType.PRESS && type !== EventType.ACTION_PRESS) return;
    const data = detail.notification?.data || {};

    if (data.type === "incoming_call") {
      if (detail.pressAction?.id === "decline") {
        await declineCallFromNotification(
          String(data.call_id || ""),
          String(data.decline_token || "")
        );
        return;
      }
      // Legacy Accept action and a plain tap both open the single incoming
      // screen. The screen itself is the only place a call can be accepted.
      emitCallRoute({ ...data, action: "ring" });
      return;
    }

    try {
      const { routeGeneralNotification } = require("./inAppNotifications");
      await routeGeneralNotification(data);
    } catch (e) {
      console.warn("[notif] could not route notification tap", e);
    }
  });
}
