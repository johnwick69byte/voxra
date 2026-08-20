import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  BackHandler,
  Alert,
  AppState,
  Pressable,
  Modal,
} from "react-native";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import Toast from "react-native-toast-message";
import { callsAPI } from "../src/services/api";
import { socketService } from "../src/services/socket";
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
import { playRingtone, stopRingtone } from "../src/services/ringtone";
import { useSecureCallScreen } from "../src/hooks/useSecureCallScreen";
import { GiftBurst, GiftFx } from "../src/components/GiftBurst";

const DISCONNECT_GRACE_MS = 20000;
const IS_PROD = !__DEV__;
const GIFT_AMOUNTS = [10, 25, 50, 100, 250];
const GIFT_ICONS = ["🎁", "💎", "🌹", "⭐", "👑"];

function CircleBtn({
  icon,
  label,
  onPress,
  color = "rgba(255,255,255,0.18)",
  iconColor = "#fff",
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  color?: string;
  iconColor?: string;
}) {
  return (
    <Pressable onPress={onPress} style={styles.circleWrap}>
      <View style={[styles.circle, { backgroundColor: color }]}>
        <Ionicons name={icon} size={24} color={iconColor} />
      </View>
      <Text style={styles.circleLabel}>{label}</Text>
    </Pressable>
  );
}

export default function CallScreen() {
  useSecureCallScreen(true);
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
  const [reconnecting, setReconnecting] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [giftsTotal, setGiftsTotal] = useState(0);
  const [earningsSession, setEarningsSession] = useState(0);
  const [giftFx, setGiftFx] = useState<GiftFx[]>([]);
  const [isLive, setIsLive] = useState(false);

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

  useEffect(() => {
    if (role === "caller" && status.startsWith("Ring")) {
      playRingtone(true);
    } else {
      stopRingtone();
    }
    return () => {
      stopRingtone();
    };
  }, [status, role]);

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
    setIsLive(true);
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
        setReconnecting(false);
      },
      onRemoteUid: (uid) => {
        setRemoteUid(uid);
        if (uid != null && graceTimer.current) {
          clearTimeout(graceTimer.current);
          graceTimer.current = null;
          setReconnecting(false);
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
    setReconnecting(true);
    Toast.show({
      type: "info",
      text1: reason,
      text2: `Reconnecting… ${DISCONNECT_GRACE_MS / 1000}s`,
    });
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
    setIsLive(false);
    await stopRingtone();
    await stopCallForegroundService();
    await endCallKeepCall(callId);
    await leaveAndDestroy(engineRef.current);
    engineRef.current = null;
    reset();
    if (navigateReview) {
      router.replace({ pathname: "/call-review", params: { callId, peerName, peerId } });
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

  const pushGiftFx = (amount: number, direction: "sent" | "received") => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setGiftFx((prev) => [...prev.slice(-4), { id, amount, direction }]);
  };

  const sendGift = async (amount: number) => {
    if (!isLive) {
      Toast.show({ type: "info", text1: "Gifts available during live call" });
      return;
    }
    try {
      const res = await callsAPI.gift(callId, amount);
      if (typeof res.data?.balance === "number") {
        setBilling(res.data.balance, totalBilled);
      }
      setGiftOpen(false);
      Toast.show({
        type: "success",
        text1: `Gifted ₹${amount}`,
        text2: res.data?.earnings != null ? `Creator gets ₹${res.data.earnings}` : undefined,
      });
      // Animation arrives via gift_sent socket for sync with peer
    } catch (e: any) {
      const statusCode = e?.response?.status;
      if (statusCode === 402) {
        Alert.alert("Insufficient balance", "Recharge to send gifts.", [
          { text: "Cancel", style: "cancel" },
          { text: "Wallet", onPress: () => router.push("/(tabs)/wallet") },
        ]);
      } else {
        Toast.show({
          type: "error",
          text1: "Gift failed",
          text2: e?.response?.data?.detail || e.message,
        });
      }
    }
  };

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

  useEffect(() => {
    const sub = AppState.addEventListener("change", async (state) => {
      if (state === "active" && liveRef.current) {
        socketService.emit("heartbeat");
      }
      if (state === "active" && role === "caller" && statusRef.current.startsWith("Ring")) {
        try {
          const res = await callsAPI.active();
          const call = res.data?.call;
          if (!call || !["RINGING", "ACCEPTED", "LIVE"].includes(call.status)) {
            await leave({ review: false });
          }
        } catch {
          /* ignore */
        }
      }
    });
    return () => sub.remove();
  }, [role, leave]);

  useEffect(() => {
    setActiveCall(callId);
    socketService.joinCall(callId);

    const onAccepted = async (payload?: any) => {
      setStatus("Connecting…");
      await stopRingtone();
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
        Toast.show({
          type: "error",
          text1: "Could not start call",
          text2: e?.response?.data?.detail,
        });
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
    const onGiftReceived = (p: any) => {
      const amt = Number(p.amount || 0);
      const earn = Number(p.earnings || 0);
      setGiftsTotal((t) => t + amt);
      setEarningsSession((t) => t + earn);
      pushGiftFx(amt, "received");
    };
    const onGiftSent = (p: any) => {
      if (typeof p.balance === "number") setBilling(p.balance, totalBilled);
      pushGiftFx(Number(p.amount || 0), "sent");
    };

    socketService.on("call_accepted", onAccepted);
    socketService.on("call_rejected", onRejected);
    socketService.on("call_missed", onMissed);
    socketService.on("call_ended", onEnded);
    socketService.on("call_ended_insufficient_balance", onEnded);
    socketService.on("call_prepaid_billed", onBilled);
    socketService.on("call_low_balance_warning", onLow);
    socketService.on("gift_received", onGiftReceived);
    socketService.on("gift_sent", onGiftSent);

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
      socketService.off("gift_received", onGiftReceived);
      socketService.off("gift_sent", onGiftSent);
      clearTimers();
      stopRingtone();
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
        {reconnecting ? (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>Reconnecting…</Text>
          </View>
        ) : null}
        {giftFx.map((g) => (
          <GiftBurst
            key={g.id}
            gift={g}
            onDone={(id) => setGiftFx((prev) => prev.filter((x) => x.id !== id))}
          />
        ))}
        <Text style={styles.peer}>{peerName}</Text>
        <Text style={styles.status}>{status}</Text>
        <Text style={styles.timer}>
          {mm}:{ss}
        </Text>
        <Text style={styles.meta}>
          {callType} · billed ₹{totalBilled.toFixed(0)} · bal ₹{balance.toFixed(0)}
          {role === "receiver" && earningsSession > 0
            ? ` · session earn ₹${earningsSession.toFixed(0)}`
            : ""}
          {role === "receiver" && giftsTotal > 0 ? ` · gifts ₹${giftsTotal}` : ""}
          {!IS_PROD && !isAgoraAvailable ? " · signaling" : ""}
        </Text>
        {lowBalance && (
          <View style={styles.warn}>
            <Text style={styles.warnText}>Low balance — ₹{balance.toFixed(0)}</Text>
          </View>
        )}

        <View style={styles.controls}>
          <CircleBtn
            icon={muted ? "mic-off" : "mic"}
            label={muted ? "Unmute" : "Mute"}
            onPress={toggleMute}
          />
          {callType === "VIDEO" && (
            <CircleBtn
              icon={videoOn ? "videocam" : "videocam-off"}
              label={videoOn ? "Cam off" : "Cam on"}
              onPress={toggleVideo}
            />
          )}
          {role === "caller" ? (
            <CircleBtn
              icon="gift"
              label="Gift"
              onPress={() => {
                if (!isLive) {
                  Toast.show({ type: "info", text1: "Gifts available during live call" });
                  return;
                }
                setGiftOpen(true);
              }}
              color="rgba(232,168,124,0.35)"
            />
          ) : (
            <CircleBtn
              icon="sparkles"
              label={earningsSession > 0 ? `₹${earningsSession.toFixed(0)}` : "Gifts"}
              onPress={() =>
                Toast.show({
                  type: "info",
                  text1:
                    giftsTotal > 0
                      ? `Gifts ₹${giftsTotal} · you earned ₹${earningsSession.toFixed(0)}`
                      : "No gifts yet",
                })
              }
              color="rgba(232,168,124,0.35)"
            />
          )}
          <CircleBtn
            icon="call"
            label="End"
            onPress={confirmEnd}
            color={theme.colors.callRed}
          />
        </View>
      </View>

      <Modal visible={giftOpen} transparent animationType="slide" onRequestClose={() => setGiftOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setGiftOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Send a gift</Text>
            <Text style={styles.sheetHint}>Creator receives ~85% after platform fee</Text>
            <View style={styles.giftRow}>
              {GIFT_AMOUNTS.map((a, i) => (
                <Pressable key={a} style={styles.giftChip} onPress={() => sendGift(a)}>
                  <Text style={styles.giftIcon}>{GIFT_ICONS[i] || "🎁"}</Text>
                  <Text style={styles.giftAmt}>₹{a}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
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
  warnText: { color: theme.colors.accent, fontFamily: theme.font.bodyBold },
  banner: {
    position: "absolute",
    top: Platform.OS === "ios" ? 100 : 80,
    backgroundColor: "rgba(217,119,6,0.9)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  giftBanner: {
    position: "absolute",
    top: Platform.OS === "ios" ? 100 : 80,
    backgroundColor: "rgba(15,118,110,0.95)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  bannerText: { color: "#fff", fontFamily: theme.font.bodyBold },
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 18,
    position: "absolute",
    bottom: 48,
    left: 16,
    right: 16,
  },
  circleWrap: { alignItems: "center", gap: 6 },
  circle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
  },
  circleLabel: { color: "rgba(255,255,255,0.8)", fontSize: 11, fontFamily: theme.font.bodySemi },
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
  sheetBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  sheetTitle: {
    fontFamily: theme.font.displayMedium,
    fontSize: 22,
    color: theme.colors.text,
    marginBottom: 6,
  },
  sheetHint: {
    fontFamily: theme.font.body,
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginBottom: 16,
  },
  giftRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  giftChip: {
    backgroundColor: theme.colors.brand,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    minWidth: 72,
    alignItems: "center",
  },
  giftIcon: { fontSize: 20, marginBottom: 4 },
  giftAmt: { color: "#fff", fontFamily: theme.font.bodyBold, fontSize: 16 },
});
