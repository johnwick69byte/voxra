import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authAPI } from "../services/api";
import { socketService } from "../services/socket";
import {
  AUTH_TOKEN_KEY,
  AUTH_TOKEN_KEY_LEGACY,
  AUTH_USER_KEY,
} from "../theme/brand";

interface AuthState {
  token: string | null;
  user: any | null;
  loading: boolean;
  hydrationError: string | null;
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

async function readCachedUser(): Promise<any | null> {
  try {
    const raw = await AsyncStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function writeSession(token: string, user: any) {
  await AsyncStorage.multiSet([
    [AUTH_TOKEN_KEY, token],
    [AUTH_USER_KEY, JSON.stringify(user)],
  ]);
  await AsyncStorage.removeItem(AUTH_TOKEN_KEY_LEGACY);
}

async function clearSession() {
  await AsyncStorage.multiRemove([
    AUTH_TOKEN_KEY,
    AUTH_TOKEN_KEY_LEGACY,
    AUTH_USER_KEY,
  ]);
}

/** Only an explicit auth rejection should end the local session. */
function isAuthRejection(error: any) {
  const status = error?.response?.status;
  return status === 401 || status === 403;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  loading: true,
  hydrationError: null,
  hydrate: async () => {
    set({ loading: true, hydrationError: null });

    let token: string | null = null;
    let cachedUser: any | null = null;
    try {
      token = await readToken();
      if (token) cachedUser = await readCachedUser();
    } catch {
      set({
        loading: false,
        hydrationError: "Could not read your saved session. Please try again.",
      });
      return;
    }

    if (!token) {
      set({ token: null, user: null, loading: false, hydrationError: null });
      return;
    }

    set({ token });

    // Show the app immediately when we already have a complete cached profile.
    // The authoritative refresh still runs below and replaces it on success.
    const canUseCache = !!cachedUser?.user_id && !!cachedUser?.profile_complete;
    if (canUseCache) {
      set({ user: cachedUser, loading: false });
      socketService.connect(cachedUser.user_id);
    }

    try {
      // A cold backend should not keep the splash screen forever. If this
      // times out, keep the stored session and use the cached profile instead.
      const res = await authAPI.me({ timeout: 12000 });
      const user = res.data?.user;
      if (!user?.user_id) throw new Error("Invalid session response");

      // A logout or a new login may have happened while this request was in
      // flight. Never let a stale restore overwrite the current session.
      if (get().token !== token) return;

      await writeSession(token, user);
      if (get().token !== token) {
        await clearSession();
        return;
      }
      set({ token, user, loading: false, hydrationError: null });
      socketService.connect(user.user_id);
    } catch (error: any) {
      if (get().token !== token) return;

      if (isAuthRejection(error)) {
        await clearSession();
        set({
          token: null,
          user: null,
          loading: false,
          hydrationError: null,
        });
        return;
      }

      // Network errors, timeouts, Render cold starts and 5xx responses are not
      // proof that the session is invalid. Keep the token instead of logging
      // the user out; use the cached profile when we have one.
      if (canUseCache) {
        set({ loading: false, hydrationError: null });
        return;
      }
      set({
        loading: false,
        hydrationError:
          "We couldn't reach Simple Talk. Check your connection and try again.",
      });
    }
  },
  setSession: async (token, user) => {
    await writeSession(token, user);
    set({ token, user, loading: false, hydrationError: null });
    socketService.connect(user.user_id);
  },
  refreshMe: async () => {
    const res = await authAPI.me();
    const user = res.data.user;
    const token = get().token;
    if (token) await writeSession(token, user);
    set({ user, hydrationError: null });
  },
  logout: async () => {
    socketService.disconnect();
    await clearSession();
    set({
      token: null,
      user: null,
      loading: false,
      hydrationError: null,
    });
  },
}));
