import { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  StyleSheet,
  Image,
  Animated,
  Vibration,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Toast from "react-native-toast-message";
import { callsAPI } from "../src/services/api";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { AppText } from "../src/components/ui";
import { cancelCallNotification } from "../src/services/IncomingCallService";
import { socketService } from "../src/services/socket";
import { playRingtone, stopRingtone } from "../src/services/ringtone";
import { ensureCallDisclaimer } from "../src/services/callDisclaimer";
import { ensureCallPermissions } from "../src/services/permissions";
import { useSecureCallScreen } from "../src/hooks/useSecureCallScreen";
import { theme } from "../src/theme/tokens";
import { APP_NAME } from "../src/theme/brand";
import { useCallStore } from "../src/store/callStore";

export default function IncomingCallScreen() {
  useSecureCallScreen(true);
  const router = useRouter();
  const params = useLocalSearchParams();
  const setIncoming = useCallStore((s) => s.setIncoming);
  const setIncomingOpen = useCallStore((s) => s.setIncomingOpen);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(45);
  const pulse = useRef(new Animated.Value(1)).current;

  const callId = String(params.callId || "");
  const callerName = String(params.callerName || "Someone");
  const callType = String(params.callType || "AUDIO");
  const channelName = String(params.channelName || "");
  const declineToken = String(params.declineToken || "");
  const autoAccept = params.autoAccept === "1";
  const incoming = useCallStore((s) => s.incoming);
  const dismissing = useRef(false);

  /** Close this screen exactly once, whatever triggered it. */
  const dismiss = useCallback(() => {
    if (dismissing.current) return;
    dismissing.current = true;
    Vibration.cancel();
    stopRingtone();
    setIncoming(null);
    setIncomingOpen(null);
    router.back();
  }, [router, setIncoming, setIncomingOpen]);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.08,
          duration: theme.motion.callPulse / 2,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: theme.motion.callPulse / 2,
          useNativeDriver: true,
        }),
      ])
    ).start();
    Vibration.vibrate([0, 500, 400, 500], true);
    playRingtone(true);
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => {
      Vibration.cancel();
      clearInterval(t);
      stopRingtone();
    };
  }, []);

  useEffect(() => {
    if (autoAccept) accept();
  }, [autoAccept]);

  // The caller can give up, or the server can time the ring out. Either way this
  // screen must stop ringing rather than counting down in the void. Only reacts
  // once the store has actually held this call, so a cold start that mounts
  // before the store populates does not immediately dismiss.
  const sawIncoming = useRef(false);
  useEffect(() => {
    if (incoming?.call_id === callId) {
      sawIncoming.current = true;
      return;
    }
    if (sawIncoming.current && incoming === null) dismiss();
  }, [incoming, callId, dismiss]);

  useEffect(() => {
    const onCancel = (payload?: any) => {
      if (payload?.call_id && payload.call_id !== callId) return;
      dismiss();
    };
    socketService.on("call_cancelled", onCancel);
    socketService.on("cancel_call_notification", onCancel);
    socketService.on("call_missed", onCancel);
    return () => {
      socketService.off("call_cancelled", onCancel);
      socketService.off("cancel_call_notification", onCancel);
      socketService.off("call_missed", onCancel);
    };
  }, [callId, dismiss]);

  useEffect(() => {
    if (countdown !== 0) return;
    // Ring window elapsed. Tell the server so the caller is released
    // immediately instead of waiting for its own timeout, then close.
    (async () => {
      try {
        await cancelCallNotification(callId);
      } catch {
        /* ignore */
      }
      dismiss();
    })();
  }, [countdown, callId, dismiss]);

  const accept = async () => {
    const agreed = await ensureCallDisclaimer();
    if (!agreed) return;
    const permitted = await ensureCallPermissions(String(callType).toUpperCase() === "VIDEO");
    if (!permitted) return;
    setBusy(true);
    await stopRingtone();
    Vibration.cancel();
    try {
      await cancelCallNotification(callId);
      const res = await callsAPI.accept(callId);
      setIncoming(null);
      dismissing.current = true;
      router.replace({
        pathname: "/call-screen",
        params: {
          callId,
          channelName: res.data.channel_name || channelName,
          callType,
          role: "receiver",
          peerName: callerName,
          peerId: String(params.callerId || res.data?.caller_id || ""),
          agoraToken: res.data.agora?.token || "",
          agoraAppId: res.data.agora?.app_id || "",
          agoraUid: String(res.data.agora?.uid ?? ""),
        },
      });
    } catch (e: any) {
      Toast.show({ type: "error", text1: "Accept failed", text2: e?.response?.data?.detail });
      router.back();
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    await stopRingtone();
    Vibration.cancel();
    try {
      await cancelCallNotification(callId);
      await callsAPI.reject(callId, declineToken);
      dismiss();
    } catch {
      dismiss();
    } finally {
      setBusy(false);
    }
  };

  return (
    <LinearGradient colors={[...theme.gradients.call]} style={styles.wrap}>
      <AppText style={styles.brand}>{APP_NAME}</AppText>
      <AppText style={styles.type}>Incoming {callType.toLowerCase()} call</AppText>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Image
          source={{ uri: String(params.callerPicture || "https://i.pravatar.cc/200") }}
          style={styles.avatar}
        />
      </Animated.View>
      <AppText style={styles.name}>{callerName}</AppText>
      <AppText style={styles.count}>{countdown}s</AppText>
      <View style={styles.hintRow}>
        <AppText style={styles.hint}>
          Swipe to answer · {callType.toLowerCase()} call
        </AppText>
      </View>
      <View style={styles.actions}>
        <PrimaryButton label="Decline" variant="danger" onPress={decline} loading={busy} style={{ flex: 1 }} />
        <PrimaryButton
          label="Accept"
          onPress={accept}
          loading={busy}
          style={{ flex: 1, backgroundColor: theme.colors.callGreen }}
        />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  brand: {
    position: "absolute",
    top: Platform.OS === "ios" ? 64 : 40,
    fontFamily: theme.font.display,
    fontSize: 22,
    color: "#F7F4EF",
  },
  type: {
    color: "rgba(247,244,239,0.7)",
    marginBottom: 24,
    fontFamily: theme.font.body,
  },
  avatar: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 3,
    borderColor: theme.colors.accent,
  },
  name: {
    fontSize: 28,
    fontFamily: theme.font.displayMedium,
    color: "#fff",
    marginTop: 24,
  },
  count: {
    color: theme.colors.accent,
    marginTop: 8,
    fontFamily: theme.font.bodySemi,
  },
  hintRow: { marginTop: 10 },
  hint: { color: "rgba(247,244,239,0.55)", fontFamily: theme.font.body, fontSize: 13 },
  actions: {
    flexDirection: "row",
    gap: 16,
    position: "absolute",
    bottom: 56,
    left: 28,
    right: 28,
  },
});
