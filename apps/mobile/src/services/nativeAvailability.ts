import { NativeModules } from "react-native";

/** True only in EAS / expo-dev-client builds that link @react-native-firebase. */
export function hasFirebaseNative(): boolean {
  return !!(NativeModules as any)?.RNFBAppModule;
}

/** True only when @notifee/react-native is linked. */
export function hasNotifeeNative(): boolean {
  const mods = NativeModules as any;
  return !!(mods?.NotifeeApiModule || mods?.NotifeeModule);
}
