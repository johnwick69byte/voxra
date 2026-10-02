import { create } from "zustand";
import { appAPI } from "../services/api";

interface NotificationsState {
  unread: number;
  refresh: () => Promise<void>;
  setUnread: (n: number) => void;
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  unread: 0,
  setUnread: (n) => set({ unread: Math.max(0, n) }),
  refresh: async () => {
    try {
      const res = await appAPI.unreadCount();
      set({ unread: Number(res.data?.unread_count || 0) });
    } catch {
      /* keep previous count */
    }
  },
}));
