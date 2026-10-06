/**
 * iOS CallKit / Android ConnectionService bridge via react-native-callkeep.
 * Gracefully no-ops in Expo Go.
 *
 * On Android, `displayIncomingCall` is silently ignored unless the app holds a
 * phone account (the "Allow Simple Talk to manage calls?" dialog from setup()).
 * `hasPhoneAccount()` exposes that so the app can warn instead of just not
 * ringing.
 */
import { Platform } from "react-native";

let CallKeep: any = null;
let ready = false;
let setupPromise: Promise<void> | null = null;

try {
  CallKeep = require("react-native-callkeep").default;
} catch {
  CallKeep = null;
}

export function isCallKeepAvailable() {
  return !!CallKeep;
}

export async function setupCallKeep() {
  if (!CallKeep) return;
  if (setupPromise) return setupPromise;
  setupPromise = (async () => {
    try {
      await CallKeep.setup({
        ios: {
          appName: "Simple Talk",
          supportsVideo: true,
          maximumCallGroups: "1",
          maximumCallsPerCallGroup: "1",
        },
        android: {
          alertTitle: "Phone account permission",
          alertDescription:
            "Simple Talk needs phone account access to show incoming calls on the lock screen.",
          cancelButton: "Cancel",
          okButton: "OK",
          // Requested alongside the phone account so the Telecom connection can
          // actually be created on first run.
          additionalPermissions: [
            "android.permission.READ_PHONE_STATE",
            "android.permission.CALL_PHONE",
            "android.permission.MANAGE_OWN_CALLS",
          ],
          foregroundService: {
            channelId: "ongoing_calls",
            channelName: "Ongoing Calls",
            notificationTitle: "Simple Talk call in progress",
          },
        },
      });
      ready = true;
    } catch (e) {
      console.warn("[CallKeep] setup failed", e);
      // Allow a later retry (e.g. after the user grants the phone account).
      setupPromise = null;
    }
  })();
  return setupPromise;
}

/** True when Android will actually accept displayIncomingCall(). */
export async function hasPhoneAccount(): Promise<boolean> {
  if (!CallKeep || Platform.OS !== "android") return false;
  await setupCallKeep();
  try {
    if (typeof CallKeep.hasPhoneAccount !== "function") return true;
    return await CallKeep.hasPhoneAccount();
  } catch {
    return false;
  }
}

export async function reportIncomingCallToCallKit(payload: Record<string, any>) {
  if (!CallKeep) {
    console.log("[CallKit] module unavailable — use an EAS build with react-native-callkeep");
    return;
  }
  await setupCallKeep();
  if (!ready) return;

  const callId = String(payload.call_id || payload.callId || "");
  const callerName = String(payload.caller_name || payload.callerName || "Someone");
  const hasVideo = String(payload.call_type || "AUDIO").toUpperCase() === "VIDEO";
  if (!callId) return;
  try {
    await CallKeep.displayIncomingCall(callId, callerName, callerName, "generic", hasVideo);
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
