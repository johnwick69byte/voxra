import { useEffect, useRef, useState } from "react";
import AgoraRTC, { IAgoraRTCClient, IAgoraRTCRemoteUser, IRemoteAudioTrack, IRemoteVideoTrack } from "agora-rtc-sdk-ng";
import "./Monitor.css";

interface Remote {
  uid: number;
  audioTrack?: IRemoteAudioTrack;
  videoTrack?: IRemoteVideoTrack;
}

export default function Monitor() {
  const [remotes, setRemotes] = useState<Remote[]>([]);
  const [status, setStatus] = useState("connecting");
  const [fitModes, setFitModes] = useState<Record<number, boolean>>({});
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const remotesRef = useRef<Map<number, Remote>>(new Map());

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const appId = q.get("appId") || "";
    const channel = q.get("channel") || "";
    const token = q.get("token") || "";
    const uid = Number(q.get("uid") || 999_999_999);
    if (!appId || !channel) {
      setStatus("missing params");
      return;
    }

    // Use Live Broadcasting mode with audience role set BEFORE joining.
    // In live mode, audience members are invisible to other channel participants —
    // the mobile clients never receive onUserJoined/onUserOffline for the admin
    // observer, so closing the popup cannot trigger the disconnect grace timer.
    const client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
    clientRef.current = client;

    client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
      await client.subscribe(user, mediaType);
      const uid = user.uid as number;
      const entry: Remote = remotesRef.current.get(uid) || { uid };
      if (mediaType === "video" && user.videoTrack) {
        entry.videoTrack = user.videoTrack;
        setRemotes((prev) => (prev.find((r) => r.uid === uid) ? prev : [...prev, entry]));
        setTimeout(() => user.videoTrack?.play(`remote-video-${uid}`), 0);
      }
      if (mediaType === "audio" && user.audioTrack) {
        entry.audioTrack = user.audioTrack;
        user.audioTrack.play();
      }
      remotesRef.current.set(uid, entry);
    });

    client.on("user-unpublished", (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
      const uid = user.uid as number;
      const entry = remotesRef.current.get(uid);
      if (!entry) return;
      if (mediaType === "video" && entry.videoTrack) {
        entry.videoTrack.stop();
        entry.videoTrack = undefined;
      }
      if (mediaType === "audio" && entry.audioTrack) {
        entry.audioTrack.stop();
        entry.audioTrack = undefined;
      }
      remotesRef.current.set(uid, entry);
    });

    client.on("user-left", (user: IAgoraRTCRemoteUser) => {
      const uid = user.uid as number;
      const entry = remotesRef.current.get(uid);
      if (entry) {
        entry.videoTrack?.stop();
        entry.audioTrack?.stop();
      }
      remotesRef.current.delete(uid);
      setRemotes((prev) => prev.filter((r) => r.uid !== uid));
    });

    (async () => {
      try {
        // audience role MUST be set before join in live mode — setting it after
        // has no effect and the client briefly joins as a host.
        await client.setClientRole("audience");
        await client.join(appId, channel, token || null, uid || 999_999_999);
        setStatus("live");
      } catch (e) {
        console.error(e);
        setStatus("join failed");
      }
    })();

    return () => {
      remotesRef.current.forEach((r) => {
        r.videoTrack?.stop();
        r.audioTrack?.stop();
      });
      remotesRef.current.clear();
      client.leave().catch(() => {});
      client.removeAllListeners();
      clientRef.current = null;
    };
  }, []);

  return (
    <div className="monitor-page">
      <div className="monitor-header">Monitor — {status}</div>
      <div className="monitor-grid">
        {remotes.length === 0 && <div className="monitor-empty">Waiting for streams…</div>}
        {remotes.map((r) => (
          <div key={r.uid} className={`monitor-cell${fitModes[r.uid] ? " fit-mode" : ""}`}>
            <div id={`remote-video-${r.uid}`} className="monitor-video" />
            <button
              className="monitor-fit-toggle"
              onClick={() => setFitModes((m) => ({ ...m, [r.uid]: !m[r.uid] }))}
            >
              {fitModes[r.uid] ? "Fill" : "Fit"}
            </button>
            <span className="monitor-uid">{r.uid}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
