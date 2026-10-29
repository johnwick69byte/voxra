import { useEffect, useRef } from "react";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppState, View, ActivityIndicator } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import Toast from "react-native-toast-message";
import { useAuthStore } from "../src/store/authStore";
import { useCallStore } from "../src/store/callStore";
import { socketService } from "../src/services/socket";
import {
  consumePendingCall,
  registerNotifeeForeground,
  cancelCallNotification,
  clearPendingCall,
} from "../src/services/IncomingCallService";
import { subscribeCallRoute } from "../src/services/callRouter";
import { subscribeNavigation } from "../src/services/navigationQueue";
import { theme } from "../src/theme/tokens";
import { useAppFonts } from "../src/theme/fonts";
import { ForceUpdateGate } from "../src/components/ForceUpdateGate";
import {
  registerDevicePushToken,
  syncPushTokenIfPermitted,
} from "../src/services/pushRegistration";
import { ensureNotificationChannels } from "../src/services/notificationChannels";
import { callsAPI } from "../src/services/api";
import { useNotificationsStore } from "../src/store/notificationsStore";
import { ensureAllPermissions } from "../src/services/permissions";
import { openCallScreen, buildCallParamsFromActive } from "../src/services/callNavigation";

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const { fontsLoaded } = useAppFonts();
  const { hydrate, loading, user, token } = useAuthStore();
  const setIncoming = useCallStore((s) => s.setIncoming);
  const router = useRouter();
  const hadSession = useRef(false);

  useEffect(() => {
    hydrate();
    // Notification channels must exist before the first push. The incoming
    // channel owns the custom sound and the white silhouette icon.
    ensureNotificationChannels();
    const unsub = registerNotifeeForeground();
    return () => {
      unsub?.();
    };
  }, []);

  // If an already-authenticated session is rejected later (expired or revoked
  // token), send the user back to login. Do nothing on a cold start with no
  // token, so public/deep-linked screens are not hijacked.
  useEffect(() => {
    if (token) {
      hadSession.current = true;
      return;
    }
    if (!loading && hadSession.current) {
      hadSession.current = false;
      router.replace("/(auth)/login");
    }
  }, [token, loading, router]);

  useEffect(() => {
    if (fontsLoaded && !loading) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, loading]);

  // FCM rotates tokens while the app is backgrounded/killed. Re-upload on every
  // foreground so an offline creator cannot silently keep a dead token.
  useEffect(() => {
    if (!user || !token) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        syncPushTokenIfPermitted().catch(() => {});
      }
    });
    return () => sub.remove();
  }, [user, token]);

  useEffect(() => {
    if (!user || !token) return;

    // Permissions first, then the push token. getToken() succeeds even when
    // notifications are denied, producing a token that can never display
    // anything -- so registration must not race the permission dialog.
    (async () => {
      // Camera, mic and notifications once per session. Every branch is a
      // no-op when the permission is already held, so this never re-prompts.
      await ensureAllPermissions();
      await registerDevicePushToken();
    })();

    /**
     * The only place an incoming screen is opened.
     *
     * Incoming calls can arrive through the socket, an FCM notification tap,
     * the persisted headless payload, and the active-call recovery endpoint.
     * They all converge here. The store claim is synchronous, so the second
     * caller is rejected before it can push a second route.
     */
    const openIncoming = async (
      payload: any,
      opts?: { action?: string; verify?: boolean }
    ) => {
      const callId = String(payload?.call_id || payload?.callId || "");
      if (!callId) return;

      // A decline coming from a legacy native/notification action must reject
      // server-side, not open the in-app screen.
      if (opts?.action === "decline") {
        try {
          await callsAPI.reject(callId, String(payload?.decline_token || ""));
        } catch {
          /* already handled */
        }
        await cancelCallNotification(callId);
        clearPendingCall(callId).catch(() => {});
        setIncoming(null);
        useCallStore.getState().setIncomingOpen(null);
        return;
      }

      // Notification taps can be seconds old. Confirm with the authoritative
      // call state before showing a screen; if the call was already accepted,
      // go straight to the call screen instead.
      let effective = payload;
      if (opts?.verify) {
        try {
          // Short timeout: a notification tap must not wait 30s for a cold
          // Render instance before showing the call screen.
          const res = await callsAPI.active({ timeout: 3500 });
          const active = res.data;
          const call = active?.call;
          if (
            !call ||
            call.call_id !== callId ||
            active.role !== "receiver" ||
            call.status !== "RINGING"
          ) {
            if (
              call?.call_id === callId &&
              ["ACCEPTED", "LIVE"].includes(call.status)
            ) {
              const params = buildCallParamsFromActive(active);
              if (params) openCallScreen(params);
            }
            return;
          }
          // Merge the fresh server record over the push payload, keeping the
          // push's caller name/picture/decline token when the active endpoint
          // does not carry them.
          effective = { ...call, ...payload };
        } catch {
          /* network unavailable: trust the fresh push payload */
        }
      }

      const store = useCallStore.getState();
      if (store.activeCallId) return;
      // The server allows only one ringing call per creator. Refusing a second
      // screen here also protects against duplicate socket/push deliveries.
      if (store.incomingOpen) return;

      store.setIncomingOpen(callId);
      setIncoming(effective);
      // Clean up any legacy Notifee notification/persisted payload. Do not
      // await: the incoming screen must appear immediately.
      cancelCallNotification(callId).catch(() => {});

      router.push({
        pathname: "/incoming-call",
        params: {
          callId,
          callerName: effective.caller_name || "Someone",
          callerId: effective.caller_id || "",
          callerPicture: effective.caller_picture || "",
          callType: effective.call_type || "AUDIO",
          channelName: effective.channel_name || "",
          declineToken: effective.decline_token || "",
        },
      });
    };

    const onIncoming = async (payload: any) => {
      await openIncoming(payload);
    };

    const onCancelNotif = async (payload: any) => {
      await cancelCallNotification(payload?.call_id);
      clearPendingCall(payload?.call_id).catch(() => {});
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
    // here. Verification is deliberately on: a tap can race the ring timeout.
    const unsubscribeRoute = subscribeCallRoute(async (payload) => {
      await openIncoming(payload, {
        action: payload.action,
        verify: payload.action !== "decline",
      });
    });

    // Taps on non-call notifications (creator online, approval, withdrawal).
    // Buffered when the tap cold-started the app, so it still navigates.
    const unsubscribeNav = subscribeNavigation((path) => {
      router.push(path as never);
    });

    /**
     * Cold-start recovery.
     *
     * /calls/active is authoritative. A persisted push payload is only used
     * when the active request cannot be completed, or when it matches the
     * active RINGING call. This removes the old race where active recovery and
     * the persisted payload each pushed their own incoming-call screen.
     */
    (async () => {
      const pending = await consumePendingCall();
      let activeData: any = null;
      let activeKnown = false;
      try {
        const res = await callsAPI.active({ timeout: 6000 });
        activeData = res.data;
        activeKnown = true;
      } catch {
        /* offline: the fresh persisted payload is the best available state */
      }

      const call = activeData?.call;
      const role = activeData?.role;
      if (call) {
        if (call.status === "RINGING" && role === "receiver") {
          const effective =
            pending?.call_id === call.call_id ? { ...call, ...pending } : call;
          await openIncoming(effective);
          return;
        }
        if (
          ["ACCEPTED", "LIVE"].includes(call.status) ||
          (call.status === "RINGING" && role === "caller")
        ) {
          const params = buildCallParamsFromActive(activeData);
          if (params) openCallScreen(params);
          return;
        }
      }

      if (pending?.call_id && !activeKnown) {
        await openIncoming(pending);
      }
    })();

    return () => {
      unsubscribeRoute();
      unsubscribeNav();
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
