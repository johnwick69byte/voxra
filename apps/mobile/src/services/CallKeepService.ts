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
          alertTitle: "Allow calls to be managed",
          alertDescription:
            "Simple Talk needs phone account access to show incoming calls on your lock screen and over other apps.",
          cancelButton: "Cancel",
          okButton: "Allow",
          // Requested alongside the phone account so the Telecom connection can
          // be created on first run.
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
      // Required on Android: sets hasListeners and hands the phone-account handle
      // to VoiceConnectionService. Without it every CallKeep event is dropped
      // (sendEventToJS checks hasListeners) and answer/end callbacks never fire.
      if (Platform.OS === "android" && typeof CallKeep.registerAndroidEvents === "function") {
        CallKeep.registerAndroidEvents();
      }
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

/**
 * Ensure the Telecom phone account exists, triggering the system dialog if not.
 *
 * `registerPhoneAccount` is the only way to reach that dialog. Sending the user
 * to app Settings (the previous approach) could never grant it, because a phone
 * account is not a normal runtime permission and has no settings toggle.
 */
export async function ensurePhoneAccount(): Promise<boolean> {
  if (!CallKeep || Platform.OS !== "android") return true;
  await setupCallKeep();

  if (await hasPhoneAccount()) return true;

  try {
    await CallKeep.registerPhoneAccount({
      android: {
        alertTitle: "Allow calls to be managed",
        alertDescription:
          "Simple Talk needs phone account access to show incoming calls on your lock screen and over other apps.",
        cancelButton: "Cancel",
        okButton: "Allow",
      },
    });
  } catch (e) {
    console.warn("[CallKeep] registerPhoneAccount failed", e);
    return false;
  }

  // The dialog is asynchronous; give Android a moment to record the account.
  for (let i = 0; i < 6; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    if (await hasPhoneAccount()) return true;
  }
  return false;
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

let listenersBound = false;

/**
 * Route native call-UI actions (answer / end from the lock screen) into the app.
 *
 * Without this the CallKeep notification can be answered but nothing happens:
 * the JS side never hears about it and the Agora room is never joined.
 */
export function bindCallKeepListeners() {
  if (!CallKeep || listenersBound) return;
  listenersBound = true;
  const { emitCallRoute } = require("./callRouter");

  const safeOn = (event: string, handler: (payload: any) => void) => {
    try {
      if (typeof CallKeep.addEventListener === "function") {
        CallKeep.addEventListener(event, handler);
      } else if (typeof CallKeep.on === "function") {
        CallKeep.on(event, handler);
      }
    } catch (e) {
      console.warn(`[CallKeep] could not bind ${event}`, e);
    }
  };

  // User answered from the native/lock-screen call UI.
  safeOn("answerCall", ({ callUUID }: any) => {
    emitCallRoute({ call_id: String(callUUID || ""), action: "accept", type: "incoming_call" });
  });

  // User rejected/hung up before answering.
  safeOn("endCall", ({ callUUID }: any) => {
    emitCallRoute({ call_id: String(callUUID || ""), action: "decline", type: "incoming_call" });
  });

  // The OS ended the call (e.g. another call took over).
  safeOn("didPerformEndCallAction", ({ callUUID }: any) => {
    emitCallRoute({ call_id: String(callUUID || ""), action: "decline", type: "incoming_call" });
  });
}
