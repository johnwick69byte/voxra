import { io, Socket } from "socket.io-client";

const SOCKET_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/api$/, "") || "https://voxra-dkfe.onrender.com";

class SocketService {
  private socket: Socket | null = null;
  private heartbeat?: ReturnType<typeof setInterval>;

  connect(userId: string) {
    if (this.socket?.connected) return;
    this.socket = io(SOCKET_URL, {
      transports: ["websocket"],
      autoConnect: true,
    });
    this.socket.on("connect", () => {
      this.socket?.emit("authenticate", { user_id: userId });
      this.heartbeat = setInterval(() => {
        this.socket?.emit("heartbeat");
      }, 20000);
    });
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
