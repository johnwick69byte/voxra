import { useEffect, useRef, useState } from "react";
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
import { playRingtone, stopRingtone } from "../src/services/ringtone";
import { ensureCallDisclaimer } from "../src/services/callDisclaimer";
import { useSecureCallScreen } from "../src/hooks/useSecureCallScreen";
import { theme } from "../src/theme/tokens";
import { useCallStore } from "../src/store/callStore";

export default function IncomingCallScreen() {
  useSecureCallScreen(true);
  const router = useRouter();
  const params = useLocalSearchParams();
  const setIncoming = useCallStore((s) => s.setIncoming);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(45);
  const pulse = useRef(new Animated.Value(1)).current;

  const callId = String(params.callId || "");
  const callerName = String(params.callerName || "Someone");
  const callType = String(params.callType || "AUDIO");
  const channelName = String(params.channelName || "");
  const declineToken = String(params.declineToken || "");
  const autoAccept = params.autoAccept === "1";

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

  useEffect(() => {
    if (countdown === 0) {
      stopRingtone();
      setIncoming(null);
      router.back();
    }
  }, [countdown]);

  const accept = async () => {
    const agreed = await ensureCallDisclaimer();
    if (!agreed) return;
    setBusy(true);
    await stopRingtone();
    Vibration.cancel();
    try {
      await cancelCallNotification(callId);
      const res = await callsAPI.accept(callId);
      setIncoming(null);
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
      setIncoming(null);
      router.back();
    } catch {
      router.back();
    } finally {
      setBusy(false);
    }
  };

  return (
    <LinearGradient colors={[...theme.gradients.call]} style={styles.wrap}>
      <AppText style={styles.brand}>Voxora</AppText>
      <AppText style={styles.type}>Incoming {callType.toLowerCase()} call</AppText>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Image
          source={{ uri: String(params.callerPicture || "https://i.pravatar.cc/200") }}
          style={styles.avatar}
        />
      </Animated.View>
      <AppText style={styles.name}>{callerName}</AppText>
      <AppText style={styles.count}>{countdown}s</AppText>
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
  actions: {
    flexDirection: "row",
    gap: 16,
    position: "absolute",
    bottom: 56,
    left: 28,
    right: 28,
  },
});
