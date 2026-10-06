import { Alert, Linking, Platform } from "react-native";
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import { Camera } from "expo-camera";

/**
 * Runtime permission gates with rationale before call / verification.
 */
export async function ensureMicPermission(): Promise<boolean> {
  const { status: existing } = await getRecordingPermissionsAsync();
  if (existing === "granted") return true;
  const proceed = await ask(
    "Microphone access",
    "Simple Talk needs your microphone for instant audio and video calls."
  );
  if (!proceed) return false;
  const { status } = await requestRecordingPermissionsAsync();
  if (status === "granted") return true;
  offerSettings("Microphone required", "Allow the microphone in system settings to place a call.");
  return false;
}

export async function ensureCameraPermission(): Promise<boolean> {
  const { status: existing } = await Camera.getCameraPermissionsAsync();
  if (existing === "granted") return true;
  const proceed = await ask(
    "Camera access",
    "Simple Talk needs your camera for video calls and creator verification selfies."
  );
  if (!proceed) return false;
  const { status } = await Camera.requestCameraPermissionsAsync();
  if (status === "granted") return true;
  offerSettings("Camera required", "Allow the camera in system settings to place a video call.");
  return false;
}

/**
 * Notification permission.
 *
 * On Android this must go through PermissionsAndroid.POST_NOTIFICATIONS
 * (Android 13+). `firebase.messaging().requestPermission()` is a NO-OP on
 * Android -- it is iOS-only and immediately resolves as AUTHORIZED without
 * showing any system dialog. Requesting through Firebase here is why the user
 * only ever saw our custom rationale popup and never the real prompt.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      const { PermissionsAndroid } = require("react-native");
      const perm = PermissionsAndroid.PERMISSIONS?.POST_NOTIFICATIONS;
      // Pre-Android-13 has no runtime notification permission at all.
      if (!perm) return true;

      const granted = await PermissionsAndroid.check(perm);
      if (granted) return true;

      const proceed = await ask(
        "Call notifications",
        "Allow notifications so you never miss an incoming call when the app is in the background."
      );
      if (!proceed) return false;

      const result = await PermissionsAndroid.request(perm);
      if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
      if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        offerSettings(
          "Notifications are off",
          "You will not receive incoming calls when the app is closed. Enable notifications in system settings."
        );
      }
      return false;
    }

    // iOS / fallback: Firebase's own request works here.
    const { NativeModules } = require("react-native");
    if (!NativeModules?.RNFBAppModule) return true;
    const messagingModule = require("@react-native-firebase/messaging");
    const messaging = messagingModule.default || messagingModule;
    const AuthStatus = messaging.AuthorizationStatus;
    const auth = await messaging().hasPermission();
    if (auth === AuthStatus.AUTHORIZED || auth === AuthStatus.PROVISIONAL) return true;

    const proceed = await ask(
      "Call notifications",
      "Allow notifications so you never miss an incoming call when the app is in the background."
    );
    if (!proceed) return false;
    const status = await messaging().requestPermission();
    return status === AuthStatus.AUTHORIZED || status === AuthStatus.PROVISIONAL;
  } catch (e) {
    console.warn("[permissions] notification request failed", e);
    return true;
  }
}

/**
 * Camera, microphone and notifications in one pass.
 *
 * Each is requested through its own platform API so the system dialog actually
 * appears. `call_phone` / phone-account access is handled by CallKeep.setup().
 */
export async function ensureAllPermissions(): Promise<{
  mic: boolean;
  camera: boolean;
  notifications: boolean;
}> {
  const [mic, camera, notifications] = await Promise.all([
    ensureMicPermission(),
    ensureCameraPermission(),
    ensureNotificationPermission(),
  ]);
  return { mic, camera, notifications };
}

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
  const cam = await ensureCameraPermission();
  if (!cam) {
    Alert.alert("Camera required", "Open settings to enable camera for verification.", [
      { text: "Cancel", style: "cancel" },
      { text: "Settings", onPress: () => Linking.openSettings() },
    ]);
    return false;
  }
  return true;
}

function offerSettings(title: string, message: string) {
  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: "Settings", onPress: () => Linking.openSettings() },
  ]);
}

function ask(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Not now", style: "cancel", onPress: () => resolve(false) },
      { text: "Continue", onPress: () => resolve(true) },
    ]);
  });
}

export function permissionPlatformHint(): string {
  return Platform.OS === "ios"
    ? "You can change this later in Settings → Simple Talk"
    : "You can change this later in App info → Permissions";
}
