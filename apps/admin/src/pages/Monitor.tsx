import { useEffect, useRef, useState } from "react";
import AgoraRTC, { IAgoraRTCClient, IAgoraRTCRemoteUser } from "agora-rtc-sdk-ng";
import "./Monitor.css";

// VideoPlayer plays directly into a DOM ref — same pattern as CelebConnect.
// This avoids the string-ID lookup that breaks across multiple browser windows.
function VideoPlayer({ videoTrack, uid }: { videoTrack: any; uid: string | number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (videoTrack && ref.current) {
      videoTrack.play(ref.current);
      return () => {
        videoTrack.stop();
      };
    }
  }, [videoTrack]);

  return (
    <div
      ref={ref}
      style={{ width: "100%", height: "100%", backgroundColor: "#000" }}
      id={`video-${uid}`}
    />
  );
}

export default function Monitor() {
  const q = new URLSearchParams(window.location.search);
  const appId = q.get("appId") || "";
  const channel = q.get("channel") || "";
  const token = q.get("token") || "";
  // Each monitor session gets its own uid from the API. Never fall back to a
  // shared fixed uid: two viewers with the same uid evict each other.
  const uid = Number.parseInt(q.get("uid") || "", 10);

  const clientRef = useRef<IAgoraRTCClient | null>(null);

  // Store raw Agora remote user objects — exactly like CelebConnect.
  // Agora keeps track refs alive on the user object; we just display them.
  const [remoteUsers, setRemoteUsers] = useState<IAgoraRTCRemoteUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<string>("DISCONNECTED");

  useEffect(() => {
    if (!appId || !channel) {
      setError("Missing appId or channel in URL params");
      return;
    }
    if (!Number.isInteger(uid) || uid <= 0) {
      setError("Missing spectator UID in the monitor link. Open Monitor from Live Ops.");
      return;
    }
    if (!token) {
      setError("Missing spectator token in the monitor link.");
      return;
    }

    const init = async () => {
      try {
        const client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
        clientRef.current = client;

        // Role MUST be set before join in live mode
        await client.setClientRole("audience");

        client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
          await client.subscribe(user, mediaType);

          if (mediaType === "audio" && user.audioTrack) {
            user.audioTrack.play();
          }

          // Store/replace the user object — Agora keeps videoTrack on it
          setRemoteUsers((prev) => {
            const exists = prev.find((u) => u.uid === user.uid);
            if (exists) {
              return prev.map((u) => (u.uid === user.uid ? user : u));
            }
            return [...prev, user];
          });
        });

        client.on("user-unpublished", (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
          // Drop only the media type that was unpublished. Removing the whole
          // user here hides a participant's video when they mute their mic.
          setRemoteUsers((prev) =>
            prev.map((u) => {
              if (u.uid !== user.uid) return u;
              const next: any = { ...u };
              if (mediaType === "video") next.videoTrack = undefined;
              else next.audioTrack = undefined;
              return next;
            })
          );
        });

        client.on("user-left", (user: IAgoraRTCRemoteUser) => {
          setRemoteUsers((prev) => prev.filter((u) => u.uid !== user.uid));
        });

        client.on("connection-state-change", (cur: string) => {
          setConnectionState(cur);
        });

        await client.join(appId, channel, token || null, uid);
      } catch (err: any) {
        console.error("Agora Monitor error:", err);
        setError(err?.message || "Failed to connect");
      }
    };

    init();

    return () => {
      if (clientRef.current) {
        clientRef.current.removeAllListeners();
        clientRef.current.leave().catch(() => {});
        clientRef.current = null;
      }
    };
  }, []);

  return (
    <div className="monitor-page">
      {/* Header */}
      <div className="monitor-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            className="monitor-status-dot"
            style={{
              backgroundColor:
                connectionState === "CONNECTED" ? "#22c55e" : "#f59e0b",
            }}
          />
          <span>Monitoring: {channel}</span>
          <span className="monitor-conn-badge">{connectionState}</span>
        </div>
        <span style={{ opacity: 0.5, fontSize: 12 }}>Admin viewer · silent</span>
      </div>

      {/* Video area */}
      <div className="monitor-video-area">
        {error ? (
          <div className="monitor-error">
            <p>⚠ {error}</p>
          </div>
        ) : (
          <>
            {/* Streams */}
            <div className="monitor-streams">
              {remoteUsers
                .filter((u) => u.videoTrack)
                .map((user) => (
                  <div key={user.uid} className="monitor-stream-cell">
                    <VideoPlayer videoTrack={user.videoTrack} uid={user.uid} />
                    <div className="monitor-uid-label">UID: {user.uid}</div>
                  </div>
                ))}
            </div>

            {/* Waiting overlay */}
            {remoteUsers.filter((u) => u.videoTrack).length === 0 &&
              connectionState === "CONNECTED" && (
                <div className="monitor-waiting">
                  <p>Waiting for participants to share video…</p>
                </div>
              )}

            {/* Connecting overlay */}
            {connectionState === "CONNECTING" && (
              <div className="monitor-waiting">
                <p>Joining channel…</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="monitor-footer">Admin Viewer Mode (Silent)</div>
    </div>
  );
}
