import { useEffect, useRef } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
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
import { subscribeCallRoute } from "../src/services/callRouter";
import { theme } from "../src/theme/tokens";
import { useAppFonts } from "../src/theme/fonts";
import { ForceUpdateGate } from "../src/components/ForceUpdateGate";
import { registerDevicePushToken } from "../src/services/pushRegistration";
import { ensureNotificationChannels } from "../src/services/notificationChannels";
import { setupCallKeep } from "../src/services/CallKeepService";
import { callsAPI } from "../src/services/api";
import { useNotificationsStore } from "../src/store/notificationsStore";
import { ensureAllPermissions } from "../src/services/permissions";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const { fontsLoaded } = useAppFonts();
  const { hydrate, loading, user, token } = useAuthStore();
  const setIncoming = useCallStore((s) => s.setIncoming);
  const setActiveCall = useCallStore((s) => s.setActiveCall);
  const router = useRouter();

  useEffect(() => {
    hydrate();
    // Bind CallKeep's answer/end listeners before setup so lock-screen actions
    // reach the app.
    try {
      require("../src/services/CallKeepService").bindCallKeepListeners();
    } catch {
      /* native module unavailable */
    }
    setupCallKeep();
    // Must exist before the first FCM push, otherwise Android falls back to a
    // silent channel with the launcher icon.
    ensureNotificationChannels();
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
    // Camera, mic, notifications and the Telecom phone account, once per
    // session. Every branch is a no-op when the permission is already held, so
    // this never re-prompts. Requesting it at login rather than mid-call means
    // the first incoming call is not missed while dialogs are on screen.
    ensureAllPermissions();

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
              agoraUid: String(agora.uid ?? ""),
            },
          });
        }
      } catch {
        /* ignore */
      }
    })();

    // A call can arrive over both the socket and FCM, and a notification tap can
    // re-deliver it. Suppress only while this call is already on screen -- using
    // a time window would swallow a tap that comes after the screen was closed
    // (e.g. the socket rang while backgrounded, then the user taps the
    // notification moments later).
    const claimCall = (callId?: string) => {
      if (!callId) return true;
      if (useCallStore.getState().incomingOpen === callId) return false;
      return true;
    };

    const openIncoming = async (payload: any, opts?: { action?: string }) => {
      // A decline coming from the native call UI must reject server-side, not
      // open the in-app screen.
      if (opts?.action === "decline") {
        try {
          await callsAPI.reject(String(payload?.call_id || ""), String(payload?.decline_token || ""));
        } catch {
          /* already handled */
        }
        await cancelCallNotification(payload?.call_id);
        useCallStore.getState().setIncomingOpen(null);
        setIncoming(null);
        return;
      }
      if (!claimCall(payload?.call_id)) return;
      const isAccept = opts?.action === "accept";
      useCallStore.getState().setIncomingOpen(payload?.call_id ?? null);
      setIncoming(payload);
      // Register the call with the OS (Android Telecom / iOS CallKit) so it can
      // take over the screen like a normal phone call. Previously this ran on
      // iOS only, which is why Android showed no full-screen incoming UI.
      await reportIncomingCallToCallKit(payload);
      if (!isAccept) {
        await showIncomingCallNotification(payload);
      }
      router.push({
        pathname: "/incoming-call",
        params: {
          callId: payload.call_id || "",
          callerName: payload.caller_name || "Someone",
          callerId: payload.caller_id || "",
          callerPicture: payload.caller_picture || "",
          callType: payload.call_type || "AUDIO",
          channelName: payload.channel_name || "",
          declineToken: payload.decline_token || "",
          autoAccept: isAccept ? "1" : "0",
        },
      });
    };

    const onIncoming = async (payload: any) => {
      await openIncoming(payload);
    };
    const onCancelNotif = async (payload: any) => {
      await cancelCallNotification(payload?.call_id);
      setIncoming(null);
      // Release the slot so a subsequent call for the same id can open again.
      useCallStore.getState().setIncomingOpen(null);
    };

    const onNewNotification = (payload: any) => {
      if (!payload || payload.type === "incoming_call") return;
      useNotificationsStore.getState().setUnread(
        useNotificationsStore.getState().unread + 1
      );
      Toast.show({
        type: payload.type?.includes("reject") ? "error" : "info",
        text1: payload.title || "New update",
        text2: payload.message,
        visibilityTime: 4000,
      });
    };

    socketService.on("incoming_call", onIncoming);
    socketService.on("cancel_call_notification", onCancelNotif);
    socketService.on("call_cancelled", onCancelNotif);
    socketService.on("call_missed", onCancelNotif);
    socketService.on("new_notification", onNewNotification);
    useNotificationsStore.getState().refresh();

    // Notification taps (cold start, backgrounded, or while running) all land
    // here. Subscribing for the lifetime of the session means a tap that
    // happens while the app is already open still opens the call screen.
    const unsubscribeRoute = subscribeCallRoute(async (payload) => {
      await openIncoming(payload, { action: payload.action });
    });

    // Anything received before this screen mounted (app cold-started by a tap).
    (async () => {
      const pending = await consumePendingCall();
      if (pending?.call_id) {
        await openIncoming(pending, { action: pending.action });
      }
    })();

    return () => {
      unsubscribeRoute();
      socketService.off("incoming_call", onIncoming);
      socketService.off("cancel_call_notification", onCancelNotif);
      socketService.off("call_cancelled", onCancelNotif);
      socketService.off("call_missed", onCancelNotif);
      socketService.off("new_notification", onNewNotification);
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
      <StatusBar style="light" />
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
        <Stack.Screen name="creator-photos" />
        <Stack.Screen name="verification-selfie" />
        <Stack.Screen name="pending-approval" />
        <Stack.Screen name="call-review" />
        <Stack.Screen name="call-history" />
        <Stack.Screen name="edit-profile" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="support" />
        <Stack.Screen name="earnings" />
        <Stack.Screen name="withdraw" />
        <Stack.Screen name="reviews" />
        <Stack.Screen name="privacy" />
        <Stack.Screen name="terms" />
      </Stack>
      <Toast />
    </>
  );
}
