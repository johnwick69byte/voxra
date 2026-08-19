/**
 * iOS CallKit / Android ConnectionService bridge via react-native-callkeep when present.
 * Gracefully no-ops in Expo Go.
 */
import { Platform } from "react-native";

let CallKeep: any = null;
let ready = false;

try {
  CallKeep = require("react-native-callkeep").default;
} catch {
  CallKeep = null;
}

export async function setupCallKeep() {
  if (!CallKeep || ready) return;
  try {
    await CallKeep.setup({
      ios: {
        appName: "Voxora",
        supportsVideo: true,
        maximumCallGroups: "1",
        maximumCallsPerCallGroup: "1",
      },
      android: {
        alertTitle: "Phone account permission",
        alertDescription: "Voxora needs phone account access to show incoming calls on the lock screen.",
        cancelButton: "Cancel",
        okButton: "OK",
        additionalPermissions: [],
        foregroundService: {
          channelId: "ongoing_calls",
          channelName: "Ongoing Calls",
          notificationTitle: "Voxora call in progress",
        },
      },
    });
    ready = true;
  } catch (e) {
    console.warn("[CallKeep] setup failed", e);
  }
}

export async function reportIncomingCallToCallKit(payload: Record<string, any>) {
  await setupCallKeep();
  if (!CallKeep) {
    console.log("[CallKit] module unavailable — use EAS build with react-native-callkeep");
    return;
  }
  const callId = String(payload.call_id || payload.callId || "");
  const callerName = String(payload.caller_name || payload.callerName || "Someone");
  const hasVideo = String(payload.call_type || "AUDIO").toUpperCase() === "VIDEO";
  try {
    if (Platform.OS === "ios") {
      CallKeep.displayIncomingCall(callId, callerName, callerName, "generic", hasVideo);
    } else {
      CallKeep.displayIncomingCall(callId, callerName, callerName, "generic", hasVideo);
    }
  } catch (e) {
    console.warn("[CallKit] displayIncomingCall failed", e);
  }
}

export async function endCallKeepCall(callId: string) {
  if (!CallKeep) return;
  try {
    CallKeep.endCall(callId);
  } catch {
    /* ignore */
  }
}
