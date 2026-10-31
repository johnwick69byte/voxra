import { useEffect, useRef, useState } from "react";
import AgoraRTC, { IAgoraRTCClient, IAgoraRTCRemoteUser } from "agora-rtc-sdk-ng";

export default function Monitor() {
  const [uids, setUids] = useState<number[]>([]);
  const [status, setStatus] = useState("connecting");
  const clientRef = useRef<IAgoraRTCClient | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const appId = q.get("appId") || "";
    const channel = q.get("channel") || "";
    const token = q.get("token") || "";
    if (!appId || !channel) {
      setStatus("missing params");
      return;
    }
    const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    clientRef.current = client;

    client.on("user-published", async (user: IAgoraRTCRemoteUser, mediaType: "audio" | "video") => {
      await client.subscribe(user, mediaType);
      if (mediaType === "video") {
        setUids((prev) => (prev.includes(user.uid as number) ? prev : [...prev, user.uid as number]));
        setTimeout(() => user.videoTrack?.play(`remote-${user.uid}`), 50);
      }
      if (mediaType === "audio") {
        user.audioTrack?.play();
      }
    });

    client.on("user-unpublished", (user, mediaType) => {
      if (mediaType === "video") {
        // keep container; track stops automatically
      }
    });

    client.on("user-left", (user) => {
      setUids((prev) => prev.filter((u) => u !== user.uid));
    });

    (async () => {
      try {
        await client.join(appId, channel, token || null, 0);
        setStatus("live");
      } catch (e) {
        console.error(e);
        setStatus("join failed");
      }
    })();

    return () => {
      client.leave().catch(() => {});
      client.removeAllListeners();
    };
  }, []);

  return (
    <div style={{ padding: 16, background: "#000", color: "#fff", minHeight: "100vh" }}>
      <h2>Monitor - {status}</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {uids.map((uid) => (
          <div
            key={uid}
            id={`remote-${uid}`}
            style={{ width: 480, height: 360, background: "#111" }}
          />
        ))}
        {uids.length === 0 && <div style={{ color: "#888" }}>Waiting for streams...</div>}
      </div>
    </div>
  );
}
