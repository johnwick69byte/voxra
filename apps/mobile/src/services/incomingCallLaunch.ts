import { NativeModules, Platform } from "react-native";

export type IncomingLaunch = {
  action?: string;
  call_id?: string;
  caller_id?: string;
  caller_name?: string;
  caller_picture?: string;
  call_type?: string;
  channel_name?: string;
  decline_token?: string;
  api_base?: string;
};

let inflight: Promise<IncomingLaunch | null> | null = null;

/** Read the lock-screen Accept action once. A second overlapping read gets nothing. */
export function consumeIncomingLaunch(): Promise<IncomingLaunch | null> {
  if (Platform.OS !== "android") return Promise.resolve(null);
  if (inflight) return Promise.resolve(null);
  const mod = NativeModules.IncomingCallLaunch;
  if (!mod?.consume) return Promise.resolve(null);
  inflight = (async () => {
    try {
      const raw = await mod.consume();
      if (!raw) return null;
      return JSON.parse(raw) as IncomingLaunch;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Close the native lock-screen UI once the in-app screen owns the call. */
export function dismissIncomingCallUi() {
  if (Platform.OS !== "android") return;
  try {
    NativeModules.IncomingCallLaunch?.dismiss?.();
  } catch {
    /* the screen may already be gone */
  }
}
