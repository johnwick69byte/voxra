import { router } from "expo-router";
import { useCallStore } from "../store/callStore";
import { cancelCallNotification } from "./IncomingCallService";

/**
 * Single navigation gate for the live call screen.
 *
 * Accept used to be handled independently by the incoming screen, native
 * CallKeep, and notification actions. Two of those paths could each mount a
 * call screen, which created two Agora engines in the same channel and evicted
 * one participant. Every path now goes through this function, and the store
 * claim makes a second navigation a no-op before React has rendered anything.
 */

export type CallScreenParams = {
  callId: string;
  role: "caller" | "receiver";
  callType: string;
  peerName: string;
  peerId: string;
  channelName: string;
  agoraToken?: string;
  agoraAppId?: string;
  agoraUid?: string;
};

let openingCallId: string | null = null;

export function openCallScreen(params: CallScreenParams): boolean {
  const callId = String(params.callId || "");
  if (!callId) return false;

  const store = useCallStore.getState();
  if (store.activeCallId === callId || openingCallId === callId) return false;

  openingCallId = callId;
  store.setActiveCall(callId);
  store.setIncoming(null);
  store.setIncomingOpen(null);

  // A rejection/cancel may have already removed the ring; make sure no stale
  // call notification survives the transition.
  cancelCallNotification(callId).catch(() => {});

  try {
    if (router.canDismiss()) router.dismissAll();
  } catch {
    /* router not ready on a very early cold start */
  }
  router.push({ pathname: "/call-screen", params });

  // The activeCallId claim lasts for the call; this only covers the short
  // window before the call screen mounts and writes its own state.
  setTimeout(() => {
    if (openingCallId === callId) openingCallId = null;
  }, 2000);
  return true;
}

export function buildCallParamsFromActive(data: any): CallScreenParams | null {
  const call = data?.call;
  if (!call?.call_id) return null;
  const role = data?.role === "caller" ? "caller" : "receiver";
  const agora = data?.agora || {};
  return {
    callId: String(call.call_id),
    role,
    callType: String(call.call_type || "AUDIO"),
    peerName: String(
      (role === "caller" ? call.receiver_name : call.caller_name) || "Peer"
    ),
    peerId: String(
      (role === "caller" ? call.receiver_id : call.caller_id) || ""
    ),
    channelName: String(call.channel_name || `channel_${call.call_id}`),
    agoraToken: String(agora.token || ""),
    agoraAppId: String(agora.app_id || ""),
    agoraUid: agora.uid != null ? String(agora.uid) : "",
  };
}

export function buildCallParamsFromAccept(args: {
  callId: string;
  callType: string;
  channelName: string;
  peerName: string;
  peerId: string;
  response: any;
}): CallScreenParams {
  const agora = args.response?.agora || {};
  return {
    callId: args.callId,
    role: "receiver",
    callType: args.callType,
    peerName: args.peerName,
    peerId: String(args.response?.caller_id || args.peerId || ""),
    channelName: String(args.response?.channel_name || args.channelName || ""),
    agoraToken: String(agora.token || ""),
    agoraAppId: String(agora.app_id || ""),
    agoraUid: agora.uid != null ? String(agora.uid) : "",
  };
}
