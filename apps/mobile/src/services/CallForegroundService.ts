/**
 * Keep the OS from killing the app during LIVE calls (Android).
 * Uses Notifee foreground service — works in EAS/dev builds with Notifee.
 * No-ops in Expo Go.
 */
import { Platform } from "react-native";
import { hasNotifeeNative } from "./nativeAvailability";

const FGS_ID = "voxora_call_fgs";

function getNotifee(): any | null {
  if (!hasNotifeeNative()) return null;
  try {
    const mod = require("@notifee/react-native");
    return mod.default || mod;
  } catch {
    return null;
  }
}

export async function startCallForegroundService(opts: {
  callId: string;
  peerName: string;
  callType: string;
}) {
  if (Platform.OS !== "android") return;
  const notifee = getNotifee();
  if (!notifee) return;
  try {
    const { AndroidImportance, AndroidCategory } = require("@notifee/react-native");
    const channelId = await notifee.createChannel({
      id: "ongoing_calls",
      name: "Ongoing Calls",
      importance: AndroidImportance.LOW,
    });
    await notifee.displayNotification({
      id: FGS_ID,
      title: `Voxora ${opts.callType === "VIDEO" ? "video" : "audio"} call`,
      body: `In call with ${opts.peerName}`,
      data: { type: "ongoing_call", call_id: opts.callId },
      android: {
        channelId,
        asForegroundService: true,
        category: AndroidCategory.CALL,
        ongoing: true,
        pressAction: { id: "default" },
      },
    });
  } catch (e) {
    console.warn("[FGS] start failed", e);
  }
}

export async function stopCallForegroundService() {
  if (Platform.OS !== "android") return;
  const notifee = getNotifee();
  if (!notifee) return;
  try {
    await notifee.stopForegroundService();
    await notifee.cancelNotification(FGS_ID);
  } catch (e) {
    console.warn("[FGS] stop failed", e);
  }
}
