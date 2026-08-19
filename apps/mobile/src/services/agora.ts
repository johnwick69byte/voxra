/**
 * Agora RTC helper — loads native module when available (dev client / EAS build).
 * Expo Go: falls back to signaling-only mode.
 */
let createAgoraRtcEngine: any = null;
let RtcSurfaceView: any = null;
let ChannelProfileType: any = {};
let ClientRoleType: any = {};
let isAgoraAvailable = false;

try {
  const Agora = require("react-native-agora");
  createAgoraRtcEngine = Agora.createAgoraRtcEngine;
  RtcSurfaceView = Agora.RtcSurfaceView;
  ChannelProfileType = Agora.ChannelProfileType || { ChannelProfileCommunication: 0 };
  ClientRoleType = Agora.ClientRoleType || { ClientRoleBroadcaster: 1 };
  isAgoraAvailable = !!createAgoraRtcEngine;
} catch {
  isAgoraAvailable = false;
}

export { isAgoraAvailable, RtcSurfaceView, ChannelProfileType, ClientRoleType };

export type AgoraJoinParams = {
  appId: string;
  token: string;
  channelName: string;
  uid?: number;
  enableVideo: boolean;
  onRemoteUid?: (uid: number | null) => void;
  onUserOffline?: () => void;
  onConnectionLost?: () => void;
  onJoined?: () => void;
  onError?: (msg: string) => void;
};

export async function createAndJoinEngine(params: AgoraJoinParams) {
  if (!isAgoraAvailable || !createAgoraRtcEngine) {
    params.onError?.("Agora native module unavailable — use a dev/EAS build");
    return null;
  }
  if (!params.appId || params.appId === "DEV_AGORA_APP_ID") {
    params.onError?.("Set AGORA_APP_ID for real media");
    // Still allow join attempt in case client has env app id
  }

  const engine = createAgoraRtcEngine();
  engine.initialize({
    appId: params.appId || process.env.EXPO_PUBLIC_AGORA_APP_ID || "",
    channelProfile: ChannelProfileType.ChannelProfileCommunication ?? 0,
  });

  engine.registerEventHandler({
    onJoinChannelSuccess: () => params.onJoined?.(),
    onUserJoined: (_conn: any, uid: number) => params.onRemoteUid?.(uid),
    onUserOffline: () => {
      params.onRemoteUid?.(null);
      params.onUserOffline?.();
    },
    onConnectionStateChanged: (_conn: any, state: number, reason: number) => {
      // 5 = Failed / 3 = Reconnecting patterns vary by SDK — treat Lost (reason network)
      if (state === 5 || reason === 2) params.onConnectionLost?.();
    },
    onError: (err: number) => params.onError?.(`Agora error ${err}`),
  });

  await engine.enableAudio();
  if (params.enableVideo) {
    await engine.enableVideo();
    await engine.startPreview();
  } else {
    await engine.disableVideo();
  }

  await engine.joinChannel(
    params.token || "",
    params.channelName,
    params.uid ?? 0,
    {
      clientRoleType: ClientRoleType.ClientRoleBroadcaster ?? 1,
      publishMicrophoneTrack: true,
      publishCameraTrack: params.enableVideo,
      autoSubscribeAudio: true,
      autoSubscribeVideo: params.enableVideo,
    }
  );

  return engine;
}

export async function leaveAndDestroy(engine: any) {
  if (!engine) return;
  try {
    await engine.leaveChannel();
  } catch {
    /* ignore */
  }
  try {
    engine.release();
  } catch {
    /* ignore */
  }
}
