import { Alert, Linking, PermissionsAndroid, Platform } from "react-native";
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from "expo-audio";
import { Camera } from "expo-camera";

/**
 * Permission handling.
 *
 * Rules, learned from two rounds of production bugs:
 *
 * 1. ALWAYS read the real OS state. Never gate on our own "already asked" flag:
 *    that silently returned `false` for a permission the user had never been
 *    asked about, and the caller then did `if (!ok) return;` -- an unresponsive
 *    button with no explanation.
 *
 * 2. Never request permissions in parallel. Android can show ONE system dialog
 *    at a time; firing camera + mic + notifications together means some requests
 *    resolve as "denied" without ever being shown. Requests are serialised here.
 *
 * 3. Only a hard denial (`canAskAgain === false`) is terminal, and only that
 *    routes to Settings. Everything else is recoverable.
 *
 * 4. Never fail silently. Callers get a reason they can show the user.
 */

export type PermissionResult = {
  granted: boolean;
  /** Why it failed, for display. Undefined when granted. */
  reason?: "denied" | "blocked" | "unavailable";
  /** Human-readable next step, when there is one. */
  message?: string;
};

const GRANTED: PermissionResult = { granted: true };

/** Serialises system dialogs so two never compete for the screen. */
let dialogChain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = dialogChain.then(task, task);
  // Keep the chain alive even when a task rejects.
  dialogChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function blockedResult(what: string): PermissionResult {
  return {
    granted: false,
    reason: "blocked",
    message: `${what} is turned off for Simple Talk. Enable it in system settings to continue.`,
  };
}

function deniedResult(what: string): PermissionResult {
  return {
    granted: false,
    reason: "denied",
    message: `${what} access is needed for this. Please allow it when prompted.`,
  };
}

/**
 * Camera permission.
 *
 * `interactive` means a user action triggered this (tapping Video call), so we
 * always attempt the system dialog when the OS still allows it.
 */
export async function ensureCameraPermission(
  opts?: { interactive?: boolean }
): Promise<PermissionResult> {
  const current = await Camera.getCameraPermissionsAsync();
  if (current.status === "granted") return GRANTED;

  // Only a definite "won't ask again" is terminal.
  if (current.canAskAgain === false) {
    return blockedResult("Camera access");
  }

  return serialize(async () => {
    // Re-read inside the lock: another dialog may have resolved this already.
    const fresh = await Camera.getCameraPermissionsAsync();
    if (fresh.status === "granted") return GRANTED;
    if (fresh.canAskAgain === false) return blockedResult("Camera access");

    const { status } = await Camera.requestCameraPermissionsAsync();
    if (status === "granted") return GRANTED;
    return deniedResult("Camera");
  });
}

/** Microphone permission. See ensureCameraPermission for the contract. */
export async function ensureMicPermission(
  opts?: { interactive?: boolean }
): Promise<PermissionResult> {
  const current = await getRecordingPermissionsAsync();
  if (current.status === "granted") return GRANTED;

  if (current.canAskAgain === false) {
    return blockedResult("Microphone access");
  }

  return serialize(async () => {
    const fresh = await getRecordingPermissionsAsync();
    if (fresh.status === "granted") return GRANTED;
    if (fresh.canAskAgain === false) return blockedResult("Microphone access");

    const { status } = await requestRecordingPermissionsAsync();
    if (status === "granted") return GRANTED;
    return deniedResult("Microphone");
  });
}

/**
 * Notification permission (Android 13+ / iOS).
 *
 * Firebase's requestPermission() is a no-op on Android, so the Android path goes
 * through PermissionsAndroid to reach the real system dialog.
 */
export async function ensureNotificationPermission(): Promise<PermissionResult> {
  try {
    if (Platform.OS === "android") {
      const perm = PermissionsAndroid.PERMISSIONS?.POST_NOTIFICATIONS;
      // Pre-Android-13 has no runtime notification permission at all.
      if (!perm) return GRANTED;

      if (await PermissionsAndroid.check(perm)) return GRANTED;

      return await serialize(async () => {
        if (await PermissionsAndroid.check(perm)) return GRANTED;
        const result = await PermissionsAndroid.request(perm);
        if (result === PermissionsAndroid.RESULTS.GRANTED) return GRANTED;
        if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
          return blockedResult("Notifications");
        }
        return deniedResult("Notification");
      });
    }

    const { NativeModules } = require("react-native");
    if (!NativeModules?.RNFBAppModule) return GRANTED;
    const messagingModule = require("@react-native-firebase/messaging");
    const messaging = messagingModule.default || messagingModule;
    const AuthStatus = messaging.AuthorizationStatus;

    const auth = await messaging().hasPermission();
    if (auth === AuthStatus.AUTHORIZED || auth === AuthStatus.PROVISIONAL) return GRANTED;

    return await serialize(async () => {
      const status = await messaging().requestPermission();
      if (status === AuthStatus.AUTHORIZED || status === AuthStatus.PROVISIONAL) {
        return GRANTED;
      }
      return deniedResult("Notification");
    });
  } catch (e) {
    console.warn("[permissions] notification request failed", e);
    // Do not block the app on an unexpected platform error.
    return GRANTED;
  }
}

/**
 * Android phone-account access for CallKeep.
 *
 * Not a runtime permission: a Telecom phone account can only be granted through
 * the system dialog that `registerPhoneAccount` raises. There is no Settings
 * toggle for it.
 */
export async function ensurePhoneAccount(): Promise<PermissionResult> {
  if (Platform.OS !== "android") return GRANTED;
  try {
    const { ensurePhoneAccount: ensure } = require("./CallKeepService");
    const ok = await ensure();
    return ok
      ? GRANTED
      : {
          granted: false,
          reason: "denied",
          message:
            "Call access was not granted, so incoming calls cannot take over your screen.",
        };
  } catch (e) {
    console.warn("[permissions] phone account check failed", e);
    return { granted: false, reason: "unavailable" };
  }
}

/**
 * Everything needed to place or receive a call.
 *
 * `interactive` is true when a user action triggered this, which makes failures
 * surface to them instead of returning silently.
 */
export async function ensureCallPermissions(
  needCamera: boolean,
  opts?: { interactive?: boolean }
): Promise<PermissionResult> {
  const mic = await ensureMicPermission(opts);
  if (!mic.granted) return mic;

  if (needCamera) {
    const cam = await ensureCameraPermission(opts);
    if (!cam.granted) return cam;
  }

  // Never block a call on notifications, but do ask.
  await ensureNotificationPermission();
  return GRANTED;
}

/** Camera, mic, notifications and the phone account, one after another. */
export async function ensureAllPermissions(): Promise<void> {
  // Sequential on purpose: Android shows one system dialog at a time, so a
  // Promise.all here causes some requests to resolve as denied without ever
  // being displayed.
  const results = [
    await ensureMicPermission(),
    await ensureCameraPermission(),
    await ensureNotificationPermission(),
    await ensurePhoneAccount(),
  ];
  const blocked = results.filter((r) => r.reason === "blocked");
  if (blocked.length) {
    Alert.alert(
      "Some access is off",
      blocked.map((r) => r.message).join("\n\n"),
      [
        { text: "Later", style: "cancel" },
        { text: "Open settings", onPress: () => Linking.openSettings() },
      ]
    );
  }
}

export async function ensureVerificationPermissions(): Promise<PermissionResult> {
  return ensureCameraPermission({ interactive: true });
}

/** Show an actionable alert for a failed permission check. */
export function explainPermissionFailure(result: PermissionResult): void {
  if (result.granted) return;
  if (result.reason === "blocked") {
    Alert.alert("Permission needed", result.message || "Enable it in system settings.", [
      { text: "Not now", style: "cancel" },
      { text: "Open settings", onPress: () => Linking.openSettings() },
    ]);
    return;
  }
  Alert.alert("Permission needed", result.message || "Please allow access to continue.");
}

export function permissionPlatformHint(): string {
  return Platform.OS === "ios"
    ? "You can change this later in Settings → Simple Talk"
    : "You can change this later in App info → Permissions";
}
