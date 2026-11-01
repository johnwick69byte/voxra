import { useEffect, useRef, useState } from "react";
import AgoraRTC, { IAgoraRTCClient, IAgoraRTCRemoteUser, IRemoteVideoTrack, IRemoteAudioTrack } from "agora-rtc-sdk-ng";
import "./Monitor.css";

// VideoPlayer renders into a real DOM ref — this is the correct Agora pattern.
// Playing into a string element ID fails when multiple monitor windows are open
// because the second window can't find the element from the first window's DOM.
function VideoPlayer({ videoTrack, uid }: { videoTrack: IRemoteVideoTrack; uid: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (videoTrack && ref.current) {
      videoTrack.play(ref.current);
      return () => videoTrack.stop();
    }
  }, [videoTrack]);
  return <div ref={ref} className="monitor-video-inner" />;
}

interface RemoteUser {
  uid: number;
  videoTrack?: IRemoteVideoTrack;
  audioTrack?: IRemoteAudioTrack;
}

export default function Monitor() {
  const [remotes, setRemotes] = useState<RemoteUser[]>([]);
  const [status, setStatus] = useState("connecting");
  const [fitModes, setFitModes] = useState<Record<number, boolean>>({});
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  // Keep a mutable map of remote users so event handlers always see fresh state
  // without capturing stale closure values.
  const remotesRef = useRef<Map<number, RemoteUser>>(new Map());

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

    // Live Broadcasting mode + audience role set BEFORE joining.
    // Audience members are invisible to channel participants — mobile clients
    // never receive onUserJoined/onUserOffline for the admin observer.
    const client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
    clientRef.current = client;

    client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
      await client.subscribe(user, mediaType);
      const remoteUid = user.uid as number;

      const entry: RemoteUser = remotesRef.current.get(remoteUid) || { uid: remoteUid };

      if (mediaType === "video" && user.videoTrack) {
        entry.videoTrack = user.videoTrack;
        remotesRef.current.set(remoteUid, entry);
        // Replace or add — triggers re-render so VideoPlayer mounts with the track
        setRemotes((prev) => {
          const exists = prev.findIndex((r) => r.uid === remoteUid);
          if (exists >= 0) {
            const next = [...prev];
            next[exists] = { ...entry };
            return next;
          }
          return [...prev, { ...entry }];
        });
      }

      if (mediaType === "audio" && user.audioTrack) {
        entry.audioTrack = user.audioTrack;
        user.audioTrack.play();
        remotesRef.current.set(remoteUid, entry);
      }
    });

    client.on("user-unpublished", (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
      const remoteUid = user.uid as number;
      const entry = remotesRef.current.get(remoteUid);
      if (!entry) return;

      if (mediaType === "video") {
        entry.videoTrack?.stop();
        entry.videoTrack = undefined;
        remotesRef.current.set(remoteUid, entry);
        setRemotes((prev) =>
          prev.map((r) => (r.uid === remoteUid ? { ...r, videoTrack: undefined } : r))
        );
      }
      if (mediaType === "audio") {
        entry.audioTrack?.stop();
        entry.audioTrack = undefined;
        remotesRef.current.set(remoteUid, entry);
      }
    });

    client.on("user-left", (user: IAgoraRTCRemoteUser) => {
      const remoteUid = user.uid as number;
      const entry = remotesRef.current.get(remoteUid);
      if (entry) {
        entry.videoTrack?.stop();
        entry.audioTrack?.stop();
      }
      remotesRef.current.delete(remoteUid);
      setRemotes((prev) => prev.filter((r) => r.uid !== remoteUid));
    });

    client.on("connection-state-change", (cur) => {
      setStatus(cur.toLowerCase());
    });

    (async () => {
      try {
        await client.setClientRole("audience");
        await client.join(appId, channel, token || null, uid || 999_999_999);
        setStatus("live");
      } catch (e: any) {
        console.error("Agora join error:", e);
        setStatus(`join failed: ${e?.message || e}`);
      }
    })();

    return () => {
      remotesRef.current.forEach((r) => {
        r.videoTrack?.stop();
        r.audioTrack?.stop();
      });
      remotesRef.current.clear();
      client.removeAllListeners();
      client.leave().catch(() => {});
      clientRef.current = null;
    };
  }, []);

  const channelName = new URLSearchParams(window.location.search).get("channel") || "";

  return (
    <div className="monitor-page">
      <div className="monitor-header">
        <span>
          <span
            className="monitor-status-dot"
            style={{ backgroundColor: status === "live" ? "#22c55e" : "#f59e0b" }}
          />
          {channelName || "Monitor"} — {status}
        </span>
        <span style={{ opacity: 0.5, fontSize: 12 }}>Admin viewer · silent</span>
      </div>

      <div className="monitor-grid">
        {remotes.length === 0 && (
          <div className="monitor-empty">Waiting for streams…</div>
        )}
        {remotes.map((r) => (
          <div
            key={r.uid}
            className={`monitor-cell${fitModes[r.uid] ? " fit-mode" : ""}`}
          >
            {r.videoTrack ? (
              <VideoPlayer videoTrack={r.videoTrack} uid={r.uid} />
            ) : (
              <div className="monitor-no-video">No video</div>
            )}
            <button
              className="monitor-fit-toggle"
              onClick={() => setFitModes((m) => ({ ...m, [r.uid]: !m[r.uid] }))}
            >
              {fitModes[r.uid] ? "Fill" : "Fit"}
            </button>
            <span className="monitor-uid">uid {r.uid}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
