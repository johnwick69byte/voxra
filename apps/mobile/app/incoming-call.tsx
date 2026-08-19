import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  Animated,
  Vibration,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Audio } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import Toast from "react-native-toast-message";
import { callsAPI } from "../src/services/api";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { cancelCallNotification } from "../src/services/IncomingCallService";
import { theme } from "../src/theme/tokens";
import { useCallStore } from "../src/store/callStore";

export default function IncomingCallScreen() {
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
        Animated.timing(pulse, { toValue: 1.08, duration: theme.motion.callPulse / 2, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: theme.motion.callPulse / 2, useNativeDriver: true }),
      ])
    ).start();
    Vibration.vibrate([0, 500, 400, 500], true);
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true }).catch(() => {});
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => {
      Vibration.cancel();
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (autoAccept) accept();
  }, [autoAccept]);

  useEffect(() => {
    if (countdown === 0) {
      setIncoming(null);
      router.back();
    }
  }, [countdown]);

  const accept = async () => {
    setBusy(true);
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
      <Text style={styles.brand}>Voxora</Text>
      <Text style={styles.type}>Incoming {callType.toLowerCase()} call</Text>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Image
          source={{ uri: String(params.callerPicture || "https://i.pravatar.cc/200") }}
          style={styles.avatar}
        />
      </Animated.View>
      <Text style={styles.name}>{callerName}</Text>
      <Text style={styles.count}>{countdown}s</Text>
      <View style={styles.actions}>
        <PrimaryButton label="Decline" variant="danger" onPress={decline} loading={busy} style={{ flex: 1 }} />
        <PrimaryButton label="Accept" onPress={accept} loading={busy} style={{ flex: 1, backgroundColor: theme.colors.callGreen }} />
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  brand: { position: "absolute", top: Platform.OS === "ios" ? 64 : 40, fontSize: 22, fontFamily: "Fraunces_700Bold", color: "#F7F4EF" },
  type: { color: "rgba(247,244,239,0.7)", marginBottom: 24, fontFamily: "Manrope_500Medium" },
  avatar: { width: 140, height: 140, borderRadius: 70, borderWidth: 3, borderColor: theme.colors.accent },
  name: { fontSize: 28, fontFamily: "Fraunces_600SemiBold", color: "#fff", marginTop: 24 },
  count: { color: theme.colors.accent, marginTop: 8, fontFamily: "Manrope_600SemiBold" },
  actions: { flexDirection: "row", gap: 16, position: "absolute", bottom: 56, left: 28, right: 28 },
});
