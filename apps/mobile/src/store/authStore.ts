import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authAPI } from "../services/api";
import { socketService } from "../services/socket";
import { AUTH_TOKEN_KEY, AUTH_TOKEN_KEY_LEGACY } from "../theme/brand";

interface AuthState {
  token: string | null;
  user: any | null;
  loading: boolean;
  hydrate: () => Promise<void>;
  setSession: (token: string, user: any) => Promise<void>;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
}

async function readToken() {
  return (
    (await AsyncStorage.getItem(AUTH_TOKEN_KEY)) ||
    (await AsyncStorage.getItem(AUTH_TOKEN_KEY_LEGACY))
  );
}

async function writeToken(token: string) {
  await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
  await AsyncStorage.removeItem(AUTH_TOKEN_KEY_LEGACY);
}

async function clearToken() {
  await AsyncStorage.multiRemove([AUTH_TOKEN_KEY, AUTH_TOKEN_KEY_LEGACY]);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  loading: true,
  hydrate: async () => {
    const token = await readToken();
    if (!token) {
      set({ loading: false });
      return;
    }
    set({ token });
    try {
      const res = await authAPI.me();
      const user = res.data.user;
      await writeToken(token);
      set({ user, loading: false });
      socketService.connect(user.user_id);
    } catch {
      await clearToken();
      set({ token: null, user: null, loading: false });
    }
  },
  setSession: async (token, user) => {
    await writeToken(token);
    set({ token, user });
    socketService.connect(user.user_id);
  },
  refreshMe: async () => {
    const res = await authAPI.me();
    set({ user: res.data.user });
  },
  logout: async () => {
    socketService.disconnect();
    await clearToken();
    set({ token: null, user: null });
  },
}));
