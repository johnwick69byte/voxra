import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator, Platform } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import Toast from "react-native-toast-message";
import { useAuthStore } from "../src/store/authStore";
import { useCallStore } from "../src/store/callStore";
import { socketService } from "../src/services/socket";
import {
  consumePendingCall,
  registerNotifeeForeground,
  cancelCallNotification,
  showIncomingCallNotification,
  reportIncomingCallToCallKit,
} from "../src/services/IncomingCallService";
import { theme } from "../src/theme/tokens";
import { useAppFonts } from "../src/theme/fonts";
import { ForceUpdateGate } from "../src/components/ForceUpdateGate";
import { registerDevicePushToken } from "../src/services/pushRegistration";
import { ensureNotificationPermission } from "../src/services/permissions";
import { setupCallKeep } from "../src/services/CallKeepService";
import { callsAPI } from "../src/services/api";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const { fontsLoaded } = useAppFonts();
  const { hydrate, loading, user, token } = useAuthStore();
  const setIncoming = useCallStore((s) => s.setIncoming);
  const setActiveCall = useCallStore((s) => s.setActiveCall);
  const router = useRouter();

  useEffect(() => {
    hydrate();
    setupCallKeep();
    const unsub = registerNotifeeForeground();
    return () => {
      unsub?.();
    };
  }, []);

  useEffect(() => {
    if (fontsLoaded && !loading) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, loading]);

  useEffect(() => {
    if (!user || !token) return;

    registerDevicePushToken();
    ensureNotificationPermission();

    (async () => {
      try {
        const res = await callsAPI.active();
        const call = res.data?.call;
        if (!call?.call_id) return;
        const role = res.data?.role || "caller";
        const agora = res.data?.agora || {};
        if (call.status === "RINGING" && role === "receiver") {
          setIncoming({
            call_id: call.call_id,
            caller_name: call.caller_name || "Caller",
            call_type: call.call_type,
            channel_name: call.channel_name,
          });
          router.push({
            pathname: "/incoming-call",
            params: {
              callId: call.call_id,
              callerName: call.caller_name || "Caller",
              callType: call.call_type || "AUDIO",
              channelName: call.channel_name || "",
            },
          });
          return;
        }
        if (call.status === "ACCEPTED" || call.status === "LIVE") {
          setActiveCall(call.call_id);
          router.push({
            pathname: "/call-screen",
            params: {
              callId: call.call_id,
              role,
              callType: call.call_type || "AUDIO",
              peerName: role === "caller" ? call.receiver_name || "Peer" : call.caller_name || "Peer",
              peerId: role === "caller" ? call.receiver_id : call.caller_id,
              channelName: call.channel_name || "",
              agoraToken: agora.token || "",
              agoraAppId: agora.app_id || "",
            },
          });
        }
      } catch {
        /* ignore */
      }
    })();

    const onIncoming = async (payload: any) => {
      setIncoming(payload);
      if (Platform.OS === "ios") {
        await reportIncomingCallToCallKit(payload);
      }
      await showIncomingCallNotification(payload);
      router.push({
        pathname: "/incoming-call",
        params: {
          callId: payload.call_id,
          callerName: payload.caller_name || "",
          callerId: payload.caller_id || "",
          callerPicture: payload.caller_picture || "",
          callType: payload.call_type || "AUDIO",
          channelName: payload.channel_name || "",
          declineToken: payload.decline_token || "",
        },
      });
    };

    const onCancelNotif = async (payload: any) => {
      await cancelCallNotification(payload?.call_id);
      setIncoming(null);
    };

    socketService.on("incoming_call", onIncoming);
    socketService.on("cancel_call_notification", onCancelNotif);
    socketService.on("call_cancelled", onCancelNotif);
    socketService.on("call_missed", onCancelNotif);

    (async () => {
      const pending = await consumePendingCall();
      if (pending) {
        setIncoming(pending);
        router.push({
          pathname: "/incoming-call",
          params: {
            callId: pending.call_id,
            callerName: pending.caller_name || "",
            callerId: pending.caller_id || "",
            callType: pending.call_type || "AUDIO",
            channelName: pending.channel_name || "",
            declineToken: pending.decline_token || "",
            autoAccept: pending.action === "accept" ? "1" : "0",
          },
        });
      }
    })();

    return () => {
      socketService.off("incoming_call", onIncoming);
      socketService.off("cancel_call_notification", onCancelNotif);
      socketService.off("call_cancelled", onCancelNotif);
      socketService.off("call_missed", onCancelNotif);
    };
  }, [user]);

  if (loading || !fontsLoaded) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: theme.colors.background,
        }}
      >
        <ActivityIndicator color={theme.colors.brand} size="large" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <ForceUpdateGate />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)/login" />
        <Stack.Screen name="(auth)/complete-profile" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="incoming-call"
          options={{ presentation: "fullScreenModal", gestureEnabled: false }}
        />
        <Stack.Screen
          name="call-screen"
          options={{ presentation: "fullScreenModal", gestureEnabled: false }}
        />
        <Stack.Screen name="creator/[id]" />
        <Stack.Screen name="pricing-setup" />
        <Stack.Screen name="verification-selfie" />
        <Stack.Screen name="pending-approval" />
        <Stack.Screen name="call-review" />
        <Stack.Screen name="call-history" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="privacy" />
        <Stack.Screen name="terms" />
      </Stack>
      <Toast />
    </>
  );
}
