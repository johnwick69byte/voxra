/**
 * Keep the OS from killing the app during LIVE calls (Android).
 * Uses Notifee foreground service — works in EAS/dev builds with Notifee.
 */
import notifee, { AndroidImportance, AndroidCategory } from "@notifee/react-native";
import { Platform } from "react-native";

const FGS_ID = "voxora_call_fgs";

export async function startCallForegroundService(opts: {
  callId: string;
  peerName: string;
  callType: string;
}) {
  if (Platform.OS !== "android") return;
  try {
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
  try {
    await notifee.stopForegroundService();
    await notifee.cancelNotification(FGS_ID);
  } catch (e) {
    console.warn("[FGS] stop failed", e);
  }
}
