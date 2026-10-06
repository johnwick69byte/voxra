import { io, Socket } from "socket.io-client";

const SOCKET_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/api$/, "") || "https://voxra-dkfe.onrender.com";

class SocketService {
  private socket: Socket | null = null;
  private heartbeat?: ReturnType<typeof setInterval>;

  connect(userId: string) {
    if (this.socket?.connected) return;
    // A previous socket may exist but be disconnected (network blip, server
    // restart). Tear it down first or every reconnect leaks a client and the
    // server keeps a stale sid mapping for this user.
    if (this.socket) {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.socket = io(SOCKET_URL, {
      transports: ["websocket"],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    this.socket.on("connect", () => {
      this.socket?.emit("authenticate", { user_id: userId });
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        this.socket?.emit("heartbeat");
      }, 20000);
    });
    // Emit a heartbeat immediately so presence is established without waiting
    // for the first interval -- otherwise a creator can look offline for 20s.
    this.socket.on("connect", () => this.socket?.emit("heartbeat"));
  }

  disconnect() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.socket?.disconnect();
    this.socket = null;
  }

  on(event: string, handler: (...args: any[]) => void) {
    this.socket?.on(event, handler);
  }

  off(event: string, handler?: (...args: any[]) => void) {
    if (handler) this.socket?.off(event, handler);
    else this.socket?.off(event);
  }

  emit(event: string, data?: unknown) {
    this.socket?.emit(event, data);
  }

  joinCall(callId: string) {
    this.socket?.emit("join_call_room", { call_id: callId });
  }
}

export const socketService = new SocketService();
