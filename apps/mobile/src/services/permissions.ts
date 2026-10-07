import { Alert, Linking, PermissionsAndroid, Platform } from "react-native";
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import { Camera } from "expo-camera";

/**
 * Permission gates.
 *
 * Design rules (these were violated before, causing repeated popups):
 *
 * 1. If the permission is already granted, return true SILENTLY. Never show a
 *    rationale when there is nothing to ask for -- that was the "we need
 *    notifications" popup appearing even after the user had granted it.
 *
 * 2. If the OS will still show a dialog, go straight to it. A custom Alert in
 *    front of a system dialog is just an extra tap for no benefit.
 *
 * 3. Only show our own Alert when the OS will NOT prompt again
 *    (NEVER_ASK_AGAIN / blocked). Then the only route is Settings, and the
 *    Alert is genuinely useful.
 *
 * 4. Never re-prompt in the same app session once we have asked. Android
 *    returns "denied" immediately after a second request, which looks like the
 *    app is nagging.
 */

/** Permissions we have already prompted for during this app session. */
const askedThisSession = new Set<string>();

function markAsked(key: string) {
  askedThisSession.add(key);
}

function alreadyAsked(key: string) {
  return askedThisSession.has(key);
}

/** Camera permission. Silent when granted; straight to the system dialog. */
export async function ensureCameraPermission(): Promise<boolean> {
  const { status: existing, canAskAgain } = await Camera.getCameraPermissionsAsync();
  if (existing === "granted") return true;

  if (existing === "denied" && canAskAgain === false) {
    offerSettings(
      "Camera access is off",
      "Simple Talk needs the camera for video calls. Enable it in system settings."
    );
    return false;
  }
  if (alreadyAsked("camera")) return false;
  markAsked("camera");

  const { status } = await Camera.requestCameraPermissionsAsync();
  return status === "granted";
}

/** Microphone permission. Silent when granted. */
export async function ensureMicPermission(): Promise<boolean> {
  const { status: existing, canAskAgain } = await getRecordingPermissionsAsync();
  if (existing === "granted") return true;

  if (existing === "denied" && canAskAgain === false) {
    offerSettings(
      "Microphone access is off",
      "Simple Talk needs the microphone for calls. Enable it in system settings."
    );
    return false;
  }
  if (alreadyAsked("mic")) return false;
  markAsked("mic");

  const { status } = await requestRecordingPermissionsAsync();
  return status === "granted";
}

/**
 * Notification permission (Android 13+ / iOS).
 *
 * Firebase's requestPermission() is a no-op on Android, so the Android path goes
 * through PermissionsAndroid to reach the real system dialog.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      const perm = PermissionsAndroid.PERMISSIONS?.POST_NOTIFICATIONS;
      // Pre-Android-13 has no runtime notification permission at all.
      if (!perm) return true;

      const granted = await PermissionsAndroid.check(perm);
      if (granted) return true;

      if (alreadyAsked("notifications")) return false;
      markAsked("notifications");

      const result = await PermissionsAndroid.request(perm);
      if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
      if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        offerSettings(
          "Notifications are off",
          "You will not get incoming calls while the app is closed. Enable notifications in system settings."
        );
      }
      return false;
    }

    const { NativeModules } = require("react-native");
    if (!NativeModules?.RNFBAppModule) return true;
    const messagingModule = require("@react-native-firebase/messaging");
    const messaging = messagingModule.default || messagingModule;
    const AuthStatus = messaging.AuthorizationStatus;

    const auth = await messaging().hasPermission();
    if (auth === AuthStatus.AUTHORIZED || auth === AuthStatus.PROVISIONAL) return true;

    if (alreadyAsked("notifications")) return false;
    markAsked("notifications");
    const status = await messaging().requestPermission();
    return status === AuthStatus.AUTHORIZED || status === AuthStatus.PROVISIONAL;
  } catch (e) {
    console.warn("[permissions] notification request failed", e);
    return true;
  }
}

/**
 * Android phone-account access for CallKeep.
 *
 * This is NOT a normal runtime permission -- it is a Telecom phone account,
 * granted through a system dialog that only `registerPhoneAccount` can trigger.
 * Sending the user to Settings (the previous behaviour) was wrong: there is no
 * toggle there to flip, which is why it looked like it was doing nothing.
 *
 * Returns true when the account exists afterwards.
 */
export async function ensurePhoneAccount(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const { ensurePhoneAccount: ensure } = require("./CallKeepService");
    return await ensure();
  } catch (e) {
    console.warn("[permissions] phone account check failed", e);
    return false;
  }
}

/**
 * Camera, microphone, notifications and phone-account access in one pass.
 *
 * Called once per session after login. Every branch is a no-op when the
 * permission is already held, so this never nags.
 */
export async function ensureAllPermissions(): Promise<{
  mic: boolean;
  camera: boolean;
  notifications: boolean;
  phoneAccount: boolean;
}> {
  const [mic, camera, notifications] = await Promise.all([
    ensureMicPermission(),
    ensureCameraPermission(),
    ensureNotificationPermission(),
  ]);
  // Last, so its system dialog is not competing with the others.
  const phoneAccount = await ensurePhoneAccount();
  return { mic, camera, notifications, phoneAccount };
}

/** Just the permissions needed to place or receive a call. */
export async function ensureCallPermissions(needCamera: boolean): Promise<boolean> {
  const mic = await ensureMicPermission();
  if (!mic) return false;
  if (needCamera) {
    const cam = await ensureCameraPermission();
    if (!cam) return false;
  }
  await ensureNotificationPermission();
  return true;
}

export async function ensureVerificationPermissions(): Promise<boolean> {
  return ensureCameraPermission();
}

function offerSettings(title: string, message: string) {
  Alert.alert(title, message, [
    { text: "Not now", style: "cancel" },
    { text: "Open settings", onPress: () => Linking.openSettings() },
  ]);
}

export function permissionPlatformHint(): string {
  return Platform.OS === "ios"
    ? "You can change this later in Settings → Simple Talk"
    : "You can change this later in App info → Permissions";
}
