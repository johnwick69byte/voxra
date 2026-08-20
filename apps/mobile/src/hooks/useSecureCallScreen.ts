import { useEffect } from "react";

/**
 * Block screenshots / screen recording while a call UI is mounted (Android FLAG_SECURE).
 * iOS support is best-effort depending on OS version.
 */
export function useSecureCallScreen(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let ScreenCapture: typeof import("expo-screen-capture") | null = null;
    try {
      ScreenCapture = require("expo-screen-capture");
    } catch {
      return;
    }
    if (!ScreenCapture) return;
    const api = ScreenCapture;
    api.preventScreenCaptureAsync().catch(() => {});
    return () => {
      api.allowScreenCaptureAsync().catch(() => {});
    };
  }, [enabled]);
}
