import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authAPI } from "../services/api";
import { socketService } from "../services/socket";

interface AuthState {
  token: string | null;
  user: any | null;
  loading: boolean;
  hydrate: () => Promise<void>;
  setSession: (token: string, user: any) => Promise<void>;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  loading: true,
  hydrate: async () => {
    const token = await AsyncStorage.getItem("voxora_token");
    if (!token) {
      set({ loading: false });
      return;
    }
    set({ token });
    try {
      const res = await authAPI.me();
      const user = res.data.user;
      set({ user, loading: false });
      socketService.connect(user.user_id);
    } catch {
      await AsyncStorage.removeItem("voxora_token");
      set({ token: null, user: null, loading: false });
    }
  },
  setSession: async (token, user) => {
    await AsyncStorage.setItem("voxora_token", token);
    set({ token, user });
    socketService.connect(user.user_id);
  },
  refreshMe: async () => {
    const res = await authAPI.me();
    set({ user: res.data.user });
  },
  logout: async () => {
    socketService.disconnect();
    await AsyncStorage.removeItem("voxora_token");
    set({ token: null, user: null });
  },
}));
