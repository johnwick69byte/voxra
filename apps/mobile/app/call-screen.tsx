import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  BackHandler,
  Alert,
  AppState,
} from "react-native";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Toast from "react-native-toast-message";
import { callsAPI } from "../src/services/api";
import { socketService } from "../src/services/socket";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { useCallStore } from "../src/store/callStore";
import { theme } from "../src/theme/tokens";
import {
  createAndJoinEngine,
  leaveAndDestroy,
  isAgoraAvailable,
  RtcSurfaceView,
} from "../src/services/agora";
import { ensureCallPermissions } from "../src/services/permissions";
import {
  startCallForegroundService,
  stopCallForegroundService,
} from "../src/services/CallForegroundService";
import { endCallKeepCall } from "../src/services/CallKeepService";

const DISCONNECT_GRACE_MS = 20000;
const IS_PROD = !__DEV__;

export default function CallScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  const callId = String(params.callId || "");
  const role = String(params.role || "caller");
  const callType = String(params.callType || "AUDIO").toUpperCase();
  const peerName = String(params.peerName || "Peer");
  const peerId = String(params.peerId || "");
  const channelName = String(params.channelName || `channel_${callId}`);
  const initialToken = String(params.agoraToken || "");
  const initialAppId = String(params.agoraAppId || "");

  const [status, setStatus] = useState(role === "caller" ? "Ringing…" : "Connecting…");
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [videoOn, setVideoOn] = useState(callType === "VIDEO");
  const [remoteUid, setRemoteUid] = useState<number | null>(null);
  const [mediaReady, setMediaReady] = useState(false);

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const billTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(Date.now());
  const engineRef = useRef<any>(null);
  const endingRef = useRef(false);
  const statusRef = useRef(status);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveRef = useRef(false);

  const { setBilling, setLowBalance, lowBalance, totalBilled, balance, setActiveCall, reset } =
    useCallStore();

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const clearTimers = () => {
    if (timer.current) clearInterval(timer.current);
    if (billTimer.current) clearInterval(billTimer.current);
    if (graceTimer.current) clearTimeout(graceTimer.current);
    timer.current = null;
    billTimer.current = null;
    graceTimer.current = null;
  };

  const startTimers = () => {
    if (timer.current) return;
    startRef.current = Date.now();
    liveRef.current = true;
    timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    billTimer.current = setInterval(async () => {
      try {
        const mins = Math.floor((Date.now() - startRef.current) / 60000);
        await callsAPI.billMinute(callId, Math.max(1, mins));
      } catch {
        /* server loop authoritative */
      }
    }, 60000);
  };

  const joinMedia = async (appId: string, token: string, channel: string) => {
    const ok = await ensureCallPermissions(callType === "VIDEO");
    if (!ok) {
      Toast.show({ type: "error", text1: "Microphone/camera permission required" });
      return;
    }
    const engine = await createAndJoinEngine({
      appId: appId || process.env.EXPO_PUBLIC_AGORA_APP_ID || "",
      token,
      channelName: channel,
      enableVideo: callType === "VIDEO",
      onJoined: () => {
        setMediaReady(true);
        setStatus("Connected");
      },
      onRemoteUid: (uid) => {
        setRemoteUid(uid);
        if (uid != null && graceTimer.current) {
          clearTimeout(graceTimer.current);
          graceTimer.current = null;
          callsAPI.reconnect(callId).catch(() => {});
          Toast.show({ type: "success", text1: "Peer reconnected" });
        }
      },
      onUserOffline: () => scheduleDisconnectGrace("Peer left the call"),
      onConnectionLost: () => scheduleDisconnectGrace("Connection lost"),
      onError: (msg) => {
        if (!isAgoraAvailable) {
          setStatus(IS_PROD ? "Connected" : "Connected (signaling only)");
          return;
        }
        Toast.show({ type: "info", text1: msg });
      },
    });
    engineRef.current = engine;
    if (!engine) {
      setStatus(IS_PROD ? "Connected" : "Connected (no native Agora)");
      setMediaReady(true);
    }
    await startCallForegroundService({ callId, peerName, callType });
  };

  const scheduleDisconnectGrace = (reason: string) => {
    if (endingRef.current || !liveRef.current) return;
    if (graceTimer.current) return;
    Toast.show({ type: "info", text1: reason, text2: `Reconnecting… ${DISCONNECT_GRACE_MS / 1000}s` });
    graceTimer.current = setTimeout(async () => {
      try {
        await callsAPI.handleDisconnect(callId);
      } catch {
        /* ignore */
      }
      await finishLeave(false);
    }, DISCONNECT_GRACE_MS);
  };

  const finishLeave = async (navigateReview: boolean) => {
    if (endingRef.current) return;
    endingRef.current = true;
    clearTimers();
    liveRef.current = false;
    await stopCallForegroundService();
    await endCallKeepCall(callId);
    await leaveAndDestroy(engineRef.current);
    engineRef.current = null;
    reset();
    if (navigateReview) {
      router.replace({
        pathname: "/call-review",
        params: { callId, peerName, peerId },
      });
    } else {
      router.replace("/(tabs)/browse");
    }
  };

  const leave = useCallback(
    async (opts?: { force?: boolean; review?: boolean }) => {
      if (endingRef.current) return;
      const isRinging = statusRef.current.startsWith("Ring");
      try {
        if (role === "caller" && isRinging) {
          await callsAPI.cancel(callId);
        } else if (!opts?.force) {
          await callsAPI.end(callId);
        }
      } catch {
        /* ignore */
      }
      await finishLeave(opts?.review !== false && !isRinging);
    },
    [callId, role]
  );

  const confirmEnd = useCallback(() => {
    Alert.alert("End call?", "This will hang up for both sides.", [
      { text: "Stay", style: "cancel" },
      { text: "End", style: "destructive", onPress: () => leave({ review: true }) },
    ]);
  }, [leave]);

  // Hardware back + gesture
  useEffect(() => {
    const onBack = () => {
      if (liveRef.current || !statusRef.current.startsWith("Ring")) {
        confirmEnd();
        return true;
      }
      leave({ review: false });
      return true;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBack);
    const unsub = navigation.addListener("beforeRemove", (e: any) => {
      if (endingRef.current) return;
      e.preventDefault();
      confirmEnd();
    });
    return () => {
      sub.remove();
      unsub();
    };
  }, [navigation, confirmEnd, leave]);

  // App background: keep call; if returning after long gap, heartbeat
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && liveRef.current) {
        socketService.emit("heartbeat");
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    setActiveCall(callId);
    socketService.joinCall(callId);

    const onAccepted = async (payload?: any) => {
      setStatus("Connecting…");
      try {
        const res = await callsAPI.prepaidStart(callId);
        const agora = res.data?.agora || payload?.agora || {};
        startTimers();
        await joinMedia(
          agora.app_id || initialAppId,
          agora.token || initialToken,
          agora.channel_name || channelName
        );
      } catch (e: any) {
        Toast.show({ type: "error", text1: "Could not start call", text2: e?.response?.data?.detail });
        await leave({ review: false });
      }
    };

    const onRejected = () => {
      Toast.show({ type: "info", text1: "Call declined" });
      leave({ review: false });
    };
    const onMissed = () => {
      Toast.show({ type: "info", text1: "No answer" });
      leave({ review: false });
    };
    const onEnded = () => {
      Toast.show({ type: "info", text1: "Call ended" });
      finishLeave(true);
    };
    const onBilled = (p: any) => setBilling(p.balance ?? 0, p.total_billed ?? 0);
    const onLow = (p: any) => {
      setLowBalance(true);
      Toast.show({
        type: "info",
        text1: "Low balance",
        text2: `${p.minutes_remaining} min left`,
      });
    };

    socketService.on("call_accepted", onAccepted);
    socketService.on("call_rejected", onRejected);
    socketService.on("call_missed", onMissed);
    socketService.on("call_ended", onEnded);
    socketService.on("call_ended_insufficient_balance", onEnded);
    socketService.on("call_prepaid_billed", onBilled);
    socketService.on("call_low_balance_warning", onLow);

    if (role === "receiver") {
      onAccepted({
        agora: { token: initialToken, app_id: initialAppId, channel_name: channelName },
      });
    }

    return () => {
      socketService.off("call_accepted", onAccepted);
      socketService.off("call_rejected", onRejected);
      socketService.off("call_missed", onMissed);
      socketService.off("call_ended", onEnded);
      socketService.off("call_ended_insufficient_balance", onEnded);
      socketService.off("call_prepaid_billed", onBilled);
      socketService.off("call_low_balance_warning", onLow);
      clearTimers();
    };
  }, [callId]);

  const toggleMute = async () => {
    const next = !muted;
    setMuted(next);
    try {
      await engineRef.current?.muteLocalAudioStream(next);
    } catch {
      /* ignore */
    }
  };

  const toggleVideo = async () => {
    if (callType !== "VIDEO") return;
    const next = !videoOn;
    setVideoOn(next);
    try {
      await engineRef.current?.muteLocalVideoStream(!next);
    } catch {
      /* ignore */
    }
  };

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const showVideo = callType === "VIDEO" && isAgoraAvailable && mediaReady;

  return (
    <View style={styles.root}>
      {showVideo ? (
        <View style={StyleSheet.absoluteFill}>
          {remoteUid != null && RtcSurfaceView ? (
            <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid: remoteUid }} />
          ) : (
            <LinearGradient colors={[...theme.gradients.call]} style={StyleSheet.absoluteFill} />
          )}
          {videoOn && RtcSurfaceView ? (
            <View style={styles.localPip}>
              <RtcSurfaceView style={StyleSheet.absoluteFill} canvas={{ uid: 0 }} zOrderMediaOverlay />
            </View>
          ) : null}
        </View>
      ) : (
        <LinearGradient colors={[...theme.gradients.call]} style={StyleSheet.absoluteFill} />
      )}

      <View style={styles.overlay}>
        <Text style={styles.brand}>Voxora</Text>
        <Text style={styles.peer}>{peerName}</Text>
        <Text style={styles.status}>{status}</Text>
        <Text style={styles.timer}>
          {mm}:{ss}
        </Text>
        <Text style={styles.meta}>
          {callType} · billed ₹{totalBilled.toFixed(0)}
          {!IS_PROD && !isAgoraAvailable ? " · signaling" : ""}
        </Text>
        {lowBalance && (
          <View style={styles.warn}>
            <Text style={styles.warnText}>Low balance — ₹{balance.toFixed(0)}</Text>
          </View>
        )}
        <View style={styles.controls}>
          <PrimaryButton label={muted ? "Unmute" : "Mute"} variant="ghost" onPress={toggleMute} style={styles.ctrl} />
          {callType === "VIDEO" && (
            <PrimaryButton
              label={videoOn ? "Cam off" : "Cam on"}
              variant="ghost"
              onPress={toggleVideo}
              style={styles.ctrl}
            />
          )}
          <PrimaryButton label="End" variant="danger" onPress={confirmEnd} style={styles.ctrl} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0B1F1A" },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  brand: {
    position: "absolute",
    top: Platform.OS === "ios" ? 64 : 40,
    fontFamily: theme.font.display,
    color: "#F7F4EF",
    fontSize: 20,
  },
  peer: { fontSize: 28, fontFamily: theme.font.displayMedium, color: "#fff" },
  status: { color: "rgba(255,255,255,0.7)", marginTop: 8, fontFamily: theme.font.body },
  timer: {
    fontSize: 48,
    fontFamily: theme.font.display,
    color: "#fff",
    marginTop: 24,
    fontVariant: ["tabular-nums"],
  },
  meta: { color: theme.colors.accent, marginTop: 8, fontFamily: theme.font.bodySemi },
  warn: {
    marginTop: 16,
    backgroundColor: "rgba(217,119,6,0.25)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  warnText: { color: theme.colors.accent, fontWeight: "700" },
  controls: {
    flexDirection: "row",
    gap: 10,
    position: "absolute",
    bottom: 56,
    left: 20,
    right: 20,
  },
  ctrl: { flex: 1 },
  localPip: {
    position: "absolute",
    top: Platform.OS === "ios" ? 100 : 80,
    right: 16,
    width: 110,
    height: 160,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.4)",
  },
});
