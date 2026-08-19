import { Alert, Linking, Platform } from "react-native";
import { Audio } from "expo-av";
import { Camera } from "expo-camera";

/**
 * Runtime permission gates with rationale before call / verification.
 */
export async function ensureMicPermission(): Promise<boolean> {
  const { status: existing } = await Audio.getPermissionsAsync();
  if (existing === "granted") return true;
  const proceed = await ask(
    "Microphone access",
    "Voxora needs your microphone for instant audio and video calls."
  );
  if (!proceed) return false;
  const { status } = await Audio.requestPermissionsAsync();
  return status === "granted";
}

export async function ensureCameraPermission(): Promise<boolean> {
  const { status: existing } = await Camera.getCameraPermissionsAsync();
  if (existing === "granted") return true;
  const proceed = await ask(
    "Camera access",
    "Voxora needs your camera for video calls and creator verification selfies."
  );
  if (!proceed) return false;
  const { status } = await Camera.requestCameraPermissionsAsync();
  return status === "granted";
}

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const messagingModule = require("@react-native-firebase/messaging");
    const messaging = messagingModule.default || messagingModule;
    const auth = await messaging().hasPermission();
    const AuthStatus = messaging.AuthorizationStatus;
    if (auth === AuthStatus.AUTHORIZED || auth === AuthStatus.PROVISIONAL) return true;
    const proceed = await ask(
      "Call notifications",
      "Allow notifications so you never miss an incoming call when the app is in the background."
    );
    if (!proceed) return false;
    const status = await messaging().requestPermission();
    return status === AuthStatus.AUTHORIZED || status === AuthStatus.PROVISIONAL;
  } catch {
    return true;
  }
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
    ? "You can change this later in Settings → Voxora"
    : "You can change this later in App info → Permissions";
}
